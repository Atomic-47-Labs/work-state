---
name: work-harvester-claude-code
description: "Harvest Claude Code session activity from `~/.claude/projects/` into `~/.work-state/` as `build`, `tool-burst`, and (optionally) `cost` events. Use whenever the user says 'harvest claude code', 'pull my claude sessions', 'sync claude code work', 'what did claude code do this week', 'how am I using claude code', 'claude code activity', 'claude code harvest', 'log my coding sessions', or any request to ingest Claude Code activity into work-state. Also trigger when work-orchestrator's daily-routine reaches the claude-code surface, or when a manual catch-up is requested with `--since`. Routes all writes through `work-state`. Idempotent — re-running is safe. Reads JSONL transcripts only — never modifies them."
---

# work-harvester-claude-code

Pull Claude Code session activity into `~/.work-state/events/` as canonical envelopes. Follows the same nine-step pattern as `work-harvester-github`: read cursor → enumerate scope → fetch since cursor → normalize → dedup-by-id → log-event → finalize-batch.

## Why this exists

Claude Code writes every session to disk as JSONL under `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`, plus a global prompt index at `~/.claude/history.jsonl`. This is rich behavioural data — every tool call, file touched, git branch, prompt — but it sits outside work-state and outside any kanban view. This harvester normalises it so Claude Code sessions show up alongside GitHub commits, Gmail drafts, and Slack posts.

## Scope: single-workstation, designed for team later

v1 reads `~/.claude/` on the machine the harvester runs on. Per-user identity is stamped from `manifest.yaml:user.email` so events are attributable when team mode is added. Each teammate runs the harvester locally; events sync up via whatever shared backing store work-state grows (out of scope here).

## Events captured

| Source                                   | work-state event type | Notes                                                            |
| ---------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| Session (one JSONL file)                 | `build`               | One event per session. `evidence.session_id`, `cwd`, `gitBranch`, durations, tool counts, file touches. |
| Significant tool burst within a session  | `tool-burst`          | Emitted when a contiguous run of tool calls exceeds threshold (default ≥ 10 calls in ≤ 5 min). |
| Daily per-user cost roll-up (Admin API)  | `cost`                | One event per user per day. Hooked but **off by default**; enabled via `surfaces.claude-code.cost.enabled: true` + `ADMIN_API_KEY`. |

Two events per session is intentional: the `build` event gives a clean per-session row for the kanban; the `tool-burst` events expose the *texture* of the session (rapid edit storms, Bash sequences, Task delegation to subagents) without flooding the timeline with one event per tool call.

## Critical: token accounting is unreliable in JSONL

JSONL's `message.usage.input_tokens` field is a streaming placeholder — most entries are 0 or 1 and are never updated to real values. Input tokens are undercounted by 100–174x, output by 10–17x in JSONL. **This harvester does not write input_tokens or output_tokens from JSONL.** Only `cache_read_input_tokens` and `cache_creation_input_tokens` are recorded from JSONL (these *are* accurate). Real token + cost data comes from the Analytics Admin API in the optional `cost` event.

## Authentication

JSONL reading: filesystem access to `~/.claude/`. No auth needed.

Admin API (optional): `ADMIN_API_KEY` env var, scoped to the Anthropic org. Fails open — if the key is missing and `cost.enabled: true`, log a warning and skip the cost path; the JSONL harvest still runs.

```bash
[ -d "${HOME}/.claude/projects" ] || { echo "~/.claude/projects not found — Claude Code not installed or never run"; exit 1; }
```

## Configuration in manifest.yaml

Added under `surfaces:`:

```yaml
surfaces:
  claude-code:
    enabled: true
    claude_home: "~/.claude"           # override for non-standard installs
    burst_threshold_calls: 10          # min tool calls
    burst_threshold_minutes: 5         # within this window
    burst_idle_gap_seconds: 60         # gap that closes a burst
    capture_prompts: false             # if true, store user prompt text in evidence.prompts (raw kept regardless)
    capture_prompt_chars: 200          # truncation when captured
    cost:
      enabled: false                   # flip to true when ADMIN_API_KEY is set
      org_id: null                     # optional, used in API path
      days_lookback: 7                 # how far back to fetch on each run
```

## How a harvest runs

### Step 1 — Read configuration

Via `work-state get-manifest`:
- `surfaces.claude-code.*` (above)
- `user.email` — stamped onto every event as `actor`
- `projects` — for project attribution by `cwd` match

Via `work-state get-cursor claude-code`:
- `state.json:last_harvest_at["claude-code"]` — high-water mark timestamp. JSONL files modified after this are candidates.

### Step 2 — Enumerate session files

```bash
since="${last_harvest_at:-$(date -u -d '30 days ago' +%FT%TZ)}"

find "${claude_home}/projects" -name '*.jsonl' -newermt "${since}" -type f
```

Each `<encoded-project>/<session-uuid>.jsonl` is one session. The encoded project name is the original `cwd` with `/` replaced by `-` (Claude Code's convention). The decoded `cwd` is also available inside the file on every line, which is what we use for project attribution.

Also read the per-project `sessions-index.json` when present — it carries auto-generated session summaries, message counts, and creation/modification timestamps that save us re-deriving them.

### Step 3 — Parse each session JSONL

Stream the file line-by-line. Each line is a JSON object with at minimum:

```
type            "user" | "assistant" | (other lifecycle types vary by version)
uuid            entry id
parentUuid      threading
timestamp       ISO-8601
sessionId       UUID, same for every line in the file
cwd             working directory
gitBranch       active git branch at the time
version         Claude Code version string
message.content array of blocks: text | thinking | tool_use | tool_result
message.usage   token usage (cache_* fields are reliable, others are NOT)
```

Walk the lines and accumulate per-session aggregates:

```python
agg = {
  "session_id": ...,
  "cwd": ...,
  "git_branch": ...,
  "version": ...,
  "started_at": min(timestamps),
  "ended_at": max(timestamps),
  "duration_seconds": ended_at - started_at,
  "user_turns": count(type == "user" and not tool_result),
  "assistant_turns": count(type == "assistant"),
  "tool_calls": {
    "Read": n, "Edit": n, "Write": n, "MultiEdit": n, "Bash": n,
    "Grep": n, "Glob": n, "Task": n, "WebFetch": n, "WebSearch": n,
    "<other>": n,
  },
  "tool_calls_total": sum(tool_calls.values()),
  "files_touched": sorted(set of file paths from Read/Edit/Write/MultiEdit inputs),
  "files_touched_count": len(files_touched),
  "bash_commands_count": count of Bash tool_use blocks,
  "subagent_invocations": count of Task tool_use blocks,
  "cache_read_tokens": sum(message.usage.cache_read_input_tokens) when present,
  "cache_creation_tokens": sum(message.usage.cache_creation_input_tokens) when present,
  "summary": sessions-index.json[session_id].summary  if available else None,
  "prompts": [
    {"timestamp": ..., "text": first N chars} for each user turn  # only if capture_prompts: true
  ],
}
```

**Important — what NOT to aggregate:**
- `message.usage.input_tokens` — JSONL placeholder, unreliable
- `message.usage.output_tokens` — JSONL placeholder, unreliable

Those fields exist in the data but we deliberately do not surface them. The `cost` event from the Admin API is the source of truth for tokens.

### Step 4 — Normalize to a `build` event envelope

```python
event = {
  "id": f"claude-code-build-{date_part(started_at)}-{session_id[:8]}",
  "surface": "claude-code",
  "type": "build",
  "timestamp": started_at,
  "actor": manifest.user.email,
  "project": attribute_project_by_cwd(cwd),
  "themes": [],
  "evidence": {
    "session_id": session_id,
    "cwd": cwd,
    "git_branch": git_branch,
    "version": version,
    "started_at": started_at,
    "ended_at": ended_at,
    "duration_seconds": duration_seconds,
    "user_turns": user_turns,
    "assistant_turns": assistant_turns,
    "tool_calls": tool_calls,           # the dict above
    "tool_calls_total": tool_calls_total,
    "files_touched": files_touched,
    "files_touched_count": files_touched_count,
    "bash_commands_count": bash_commands_count,
    "subagent_invocations": subagent_invocations,
    "cache_read_tokens": cache_read_tokens,
    "cache_creation_tokens": cache_creation_tokens,
    "summary": summary,
    "prompts": prompts,                 # [] if capture_prompts: false
    "jsonl_path": str(path),            # for backtracing
  },
  "metrics": {
    "session_minutes": round(duration_seconds / 60, 1),
    "tools_per_minute": round(tool_calls_total / max(duration_seconds/60, 1), 2),
    "session_size_class": classify_session(tool_calls_total, duration_seconds),
    "agentic_ratio": round(tool_calls_total / max(user_turns, 1), 2),   # tools per user prompt
  },
  "raw": None,                          # JSONL is large; we don't inline it. evidence.jsonl_path is the pointer.
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

`classify_session` (analogous to GitHub's `classify_size`):

| total tool calls | duration            | class       |
| ---------------- | ------------------- | ----------- |
| < 5              | any                 | `trivial`   |
| < 25             | < 15 min            | `quick`     |
| < 100            | < 60 min            | `focused`   |
| < 250            | < 180 min           | `deep`      |
| ≥ 250 OR ≥ 180m  | —                   | `marathon`  |

### Step 5 — Project attribution by `cwd`

```python
def attribute_project_by_cwd(cwd):
    cwd_lower = cwd.lower()
    for project in manifest["projects"]:
        # Match by repo path or aliases appearing as a path component
        for alias in project.get("aliases", []) + [project["id"]]:
            if f"/{alias.lower()}" in cwd_lower or cwd_lower.endswith(f"/{alias.lower()}"):
                return project["id"]
    return "unsorted"
```

`cwd`-based attribution is more reliable than GitHub's repo-name match because Claude Code captures the exact working directory at session time. The `unsorted` bucket can be corrected later by `work-themes` or by hand-edited correction events.

### Step 6 — Detect significant tool bursts

While streaming the session lines, also maintain a sliding window of tool_use timestamps. Emit a `tool-burst` event when:

```
window contains ≥ burst_threshold_calls tool_use blocks
window span ≤ burst_threshold_minutes
followed by an idle gap ≥ burst_idle_gap_seconds (the burst is "closed")
```

```python
burst_event = {
  "id": f"claude-code-tool-burst-{date_part(burst_start)}-{session_id[:8]}-{burst_index}",
  "surface": "claude-code",
  "type": "tool-burst",
  "timestamp": burst_start,
  "actor": manifest.user.email,
  "project": attribute_project_by_cwd(cwd),
  "themes": [],
  "evidence": {
    "session_id": session_id,
    "burst_index": burst_index,             # 0, 1, 2... within the session
    "burst_start": burst_start,
    "burst_end": burst_end,
    "burst_duration_seconds": burst_end - burst_start,
    "tool_calls": <tool_call_counts_for_this_window>,
    "tool_calls_total": <total>,
    "dominant_tool": <name with highest count>,
    "files_touched": <files_touched_in_this_window>,
    "git_branch": git_branch,
    "preceding_idle_seconds": gap_before,    # null on first burst
  },
  "metrics": {
    "burst_intensity": round(total / (burst_duration_seconds/60), 2),  # tools/min
    "burst_size_class": classify_burst(total),
  },
  "raw": None,
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

`classify_burst`:
- `< 25` → `"compact"`
- `< 75` → `"intense"`
- `≥ 75` → `"sustained"`

The burst index within the session ensures determinism: re-running produces the same id, same content.

### Step 7 — Write each event via `work-state log-event`

```python
for event in [build_event] + burst_events:
    result = work_state.log_event(event)
    if result.status == "duplicate":
        skipped += 1
    elif result.status == "written":
        written += 1
```

### Step 8 — Cost event (optional, off by default)

If `surfaces.claude-code.cost.enabled` and `ADMIN_API_KEY` is set:

```bash
for d in $(seq 0 $((days_lookback - 1))); do
  date_str=$(date -u -d "${d} days ago" +%F)
  curl -s "https://api.anthropic.com/v1/organizations/usage_report/claude_code?starting_at=${date_str}&limit=200" \
    -H "anthropic-version: 2023-06-01" \
    -H "x-api-key: ${ADMIN_API_KEY}"
done
```

For each user record returned (filter to `record.email == manifest.user.email` in single-workstation mode):

```python
cost_event = {
  "id": f"claude-code-cost-{record.date}-{hash(record.email)[:6]}",
  "surface": "claude-code",
  "type": "cost",
  "timestamp": f"{record.date}T00:00:00Z",
  "actor": record.email,
  "project": "unsorted",                # Admin API is per-user-per-day, not per-project
  "themes": [],
  "evidence": {
    "date": record.date,
    "sessions": record.sessions,
    "lines_added": record.lines_added,
    "lines_removed": record.lines_removed,
    "commits": record.commits,
    "pull_requests": record.pull_requests,
    "tool_acceptance": record.tool_acceptance,   # the Edit/MultiEdit/Write/NotebookEdit accept/reject dict
    "tokens_by_model": record.tokens_by_model,
    "estimated_cost_usd": record.estimated_cost_usd,
  },
  "metrics": {
    "total_tokens": sum tokens across models,
    "estimated_cost_usd": record.estimated_cost_usd,
  },
  "raw": record,
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

Cost events are intentionally **non-overlapping** with build events — they live on a daily grain, not a session grain. Joining them in dashboards is downstream work.

Note: Admin API data typically appears within 1 hour of activity, so the cost path is always running 1+ hours behind the JSONL path. That's fine — they're independent.

### Step 9 — Finalize the batch

```python
work_state.finalize_batch({
  "surface": "claude-code",
  "count": written,
  "max_timestamp": max(e.timestamp for e in written_events),
  "harvester": "work-harvester-claude-code",
  "harvester_version": "1.0.0",
})
```

### Step 10 — Per-surface harvest log

```bash
echo "{\"ts\":\"${now}\",\"sessions_scanned\":${count},\"build_events\":${b},\"burst_events\":${tb},\"cost_events\":${c},\"events_skipped\":${skipped},\"errors\":[...]}" \
  >> ~/.work-state/harvest/claude-code/$(date +%F).log
```

## CLI surface

```bash
# Standard daily harvest (uses cursor)
work-harvester-claude-code

# Catch up over a longer window
work-harvester-claude-code --since 30d
work-harvester-claude-code --since 2026-04-01

# Dry run — show what would be written, don't write
work-harvester-claude-code --dry-run

# Specific session only (debugging)
work-harvester-claude-code --session-id abc123def456

# Force cost path even if disabled in manifest
work-harvester-claude-code --include-cost

# Skip cost path even if enabled
work-harvester-claude-code --skip-cost

# Reprocess existing JSONL (ignore cursor)
work-harvester-claude-code --since all --reprocess
```

## Errors & how this harvester handles them

| Error                                         | Behavior                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `~/.claude/projects` missing                  | Fail fast with installation note. Don't write anything.                 |
| Single JSONL file malformed (mid-line corrupt)| Log the path + the line number, skip the file, continue with others.    |
| Session file truncated (no end timestamp)     | Treat as in-progress: emit build event with `duration_seconds: null` and flag `evidence.session_status: "in_progress"`. On next run, the same session may emit a corrected event (idempotent id ensures replacement, not duplication, if `work-state` is configured for upsert; otherwise the in-progress event remains and a finalize-marker event is appended). |
| Admin API rate limit                          | Retry once with backoff; if still limited, log and skip cost path, continue JSONL path. |
| Admin API auth failure                        | Log warning, skip cost path, continue JSONL path. Never fails the whole harvest on auth. |
| `work-state log-event` returns an error       | Halt the batch, log the error, do NOT advance the cursor. Re-running retries the same sessions. |

## Idempotency proof

Three deterministic id schemes:

```
claude-code-build-{YYYY-MM-DD}-{first 8 chars of session_id}
claude-code-tool-burst-{YYYY-MM-DD}-{first 8 chars of session_id}-{burst_index}
claude-code-cost-{YYYY-MM-DD}-{first 6 chars of email hash}
```

Same session → same build id. Same session + same burst index → same tool-burst id. Same date + same user → same cost id. `work-state log-event` returns `{status: "duplicate"}` and the run is a no-op for already-harvested data.

The one wrinkle: in-progress sessions. A long-running session may be harvested mid-flight; the next harvest sees a now-finished version of the same file. The build id is identical, so the second write would dedupe. To handle this correctly, the harvester checks if a previously-written event has `evidence.session_status == "in_progress"` and, if so, asks `work-state` to *replace* it with the finalized version. This requires `work-state` to support an upsert path; if not available, the harvester emits a `session-finalized` correction event instead and leaves the original in place.

## Privacy posture

Same as Gmail/Slack harvesters:

- `evidence.prompts` is **off by default**. Even when on, prompts truncate to `capture_prompt_chars` (default 200).
- `evidence.files_touched` lists paths only — no file contents.
- `evidence.summary` (from `sessions-index.json`) is Claude Code's own auto-generated summary; safe to include.
- `raw: None` for JSONL events — the full transcript stays at `evidence.jsonl_path` and is read on-demand by downstream skills.
- The full JSONL itself is **not copied** into work-state. It stays in `~/.claude/projects/`.
- Local-first: nothing leaves the facility.

## What this harvester does NOT do

- **Does not write input_tokens or output_tokens from JSONL.** They are unreliable. Use the `cost` event.
- **Does not interpret prompt content for themes.** `themes: []` is empty; `work-themes` walks events later.
- **Does not modify or delete JSONL files.** Read-only.
- **Does not run OpenTelemetry.** That's a separate, future harvester (`work-harvester-claude-code-otel`) for teams that wire up an OTLP collector.
- **Does not attribute tool-bursts to a specific commit.** Joining bursts to commits is downstream work (a synthesis skill could pair `claude-code:tool-burst` events with adjacent `github:build` events on the same branch).
- **Does not cross-machine deduplicate.** v1 is single-workstation. When team mode arrives, `actor` + `session_id` is globally unique (session UUIDs don't collide), so cross-machine merge is straightforward.

## Team-mode readiness (notes for v2)

The fields already in place for team mode:

- `actor` is on every event — set from `manifest.user.email` at write time
- `id` includes only date + session-id, not hostname — IDs are already globally unique
- The cost event filters by `actor` — when each teammate runs locally, each writes only their own

What v2 will add:

- A merge layer that pulls each teammate's `~/.work-state/events/claude-code/` into a shared store
- Per-user kanban filtering
- Aggregate "team velocity" rollups in `work-metrics`
- Admin API runs once at the org level and emits cost events for all users (currently filtered to one)

## Reference files

- `references/event-templates/build.json` — example normalized session envelope
- `references/event-templates/tool-burst.json` — example normalized burst envelope
- `references/event-templates/cost.json` — example normalized cost envelope
- `references/jsonl-fields.md` — the JSONL fields we read and the ones we deliberately ignore
- `references/burst-detection.md` — the sliding-window algorithm in pseudocode

If the reference files are missing, the SKILL.md instructions above are self-sufficient.
