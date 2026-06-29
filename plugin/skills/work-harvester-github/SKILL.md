---
name: work-harvester-github
description: "Harvest GitHub events (commits, PRs, releases, branch creations) into `~/work-state/`. Use whenever the user says 'harvest github', 'pull my commits', 'sync github work', 'github events', 'log my pushes', 'what did I commit this week', 'github harvest', 'pull recent commits', or any request to ingest GitHub activity into work-state. Also trigger when work-orchestrator's daily-routine reaches the github surface, when a webhook delivers a GitHub event, or when a manual catch-up is requested with `--since`. Routes all writes through `work-state`. Idempotent — re-running is safe."
---

# work-harvester-github — pattern reference

This is the **template** harvester. Every other `work-harvester-*` skill follows the same shape: read cursor → fetch from surface → normalize to envelope → dedup-by-id → log-event for each → finalize-batch.

## Purpose

Pull events from GitHub into `~/work-state/events/` as canonical envelopes. The events captured:

| GitHub action                  | work-state event type | Notes                                          |
| ------------------------------ | --------------------- | ---------------------------------------------- |
| Push (commits)                 | `build`               | One event per commit. Merge commits skipped if `is_merge`. |
| PR opened / merged             | `build`               | The merge commit captures the build; the PR open captures the draft transition. |
| Release published              | `publish`             | Tagged release with notes.                     |
| Branch created                 | `draft`               | Treated as the start of a workstream.          |
| Issue / PR comment authored    | `share`               | Inbound comments are `receive`; outbound are `share`. |

## Authentication

Uses the `gh` CLI (already authenticated on David's machine). If `gh` is missing, the harvester fails fast with instructions to install + authenticate.

```bash
command -v gh >/dev/null || { echo "gh CLI not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated; run: gh auth login"; exit 1; }
```

## How a harvest runs

### Step 1 — Read configuration

Via `work-state get-manifest`:
- `manifest.yaml:surfaces.github.repos_scope` (`owned` | `starred` | `all_accessible`)
- `manifest.yaml:surfaces.github.include_private`
- `manifest.yaml:projects` (for project attribution)

Via `work-state get-cursor github`:
- `state.json:last_harvest_at["github"]` — the high-water mark timestamp.

### Step 2 — Determine repos to scan

```bash
case "${repos_scope}" in
  owned)         gh repo list "${USER}" --limit 200 --json nameWithOwner ;;
  starred)       gh api user/starred --paginate ;;
  all_accessible) gh repo list --limit 500 --json nameWithOwner ;;
esac
```

If `include_private: false`, filter out `isPrivate: true` repos.

### Step 3 — For each repo, pull commits since cursor

```bash
since="${last_harvest_at:-$(date -u -d '30 days ago' +%FT%TZ)}"
# ^ default to 30 days ago if cursor is null (first harvest)

gh api "repos/${repo}/commits?since=${since}&author=${USER}" --paginate
```

Filtering by `author=${USER}` is critical — we only want **David's** commits in his work-state, not commits by collaborators. (Cross-portfolio attribution is downstream.)

### Step 4 — Normalize each commit to an envelope

For each commit `c`:

```python
event = {
  "id": f"github-build-{date_part(c.commit.author.date)}-{sha_hash(c.sha)[:6]}",
  "surface": "github",
  "type": "build",
  "timestamp": c.commit.author.date,
  "project": attribute_project(repo_name),  # see below
  "themes": [],                              # left empty; work-themes enriches later
  "evidence": {
    "repo": repo_name,
    "sha": c.sha,
    "branch": c.branch_inferred or "main",
    "message": c.commit.message,
    "url": c.html_url,
    "files_changed": c.stats.total_files,
    "additions": c.stats.additions,
    "deletions": c.stats.deletions,
    "is_merge": len(c.parents) > 1,
    "pr_ref": extract_pr_ref(c.commit.message),  # parses "(#123)" suffix
  },
  "metrics": {
    "lines_changed": c.stats.additions + c.stats.deletions,
    "files_changed": c.stats.total_files,
    "commit_size_class": classify_size(c.stats.additions + c.stats.deletions),
  },
  "raw": c,                                  # full untruncated GitHub API response
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

`classify_size`:
- `< 10 lines` → `"trivial"`
- `< 50 lines` → `"small"`
- `< 250 lines` → `"medium"`
- `< 1000 lines` → `"large"`
- `≥ 1000 lines` → `"huge"`

### Step 5 — Project attribution

```python
def attribute_project(repo_name):
    # repo_name is "owner/name"; we care about the name part for matching.
    name = repo_name.split("/")[1].lower()
    for project in manifest["projects"]:
        for alias in project["aliases"] + [project["id"]]:
            if alias.lower() in name:
                return project["id"]
    return "unsorted"
```

This is intentionally simple. `work-themes` can correct attributions later via correction events.

### Step 6 — Write each event via `work-state log-event`

For each normalized event:

```python
result = work_state.log_event(event)
if result.status == "duplicate":
    skipped += 1
elif result.status == "written":
    written += 1
```

Skipped events are not an error — they mean the harvest is overlapping with a prior run, which is exactly what we want for idempotency.

### Step 7 — Pull releases as `publish` events

```bash
gh api "repos/${repo}/releases?per_page=100" --paginate
```

Releases since cursor → `type: "publish"` events with evidence `{tag_name, name, body, url, prerelease, draft}`.

### Step 8 — Pull PRs (open/merge) as draft/build markers

For each PR opened by `${USER}` since cursor:

- The opening of the PR → `type: "draft"` event (the workstream began).
- The merge of the PR → captured by the merge commit in Step 4, so we don't double-count.

### Step 9 — Finalize the batch

```python
work_state.finalize_batch({
  "surface": "github",
  "count": written,
  "max_timestamp": max(e.timestamp for e in written_events),
  "harvester": "work-harvester-github",
  "harvester_version": "1.0.0",
})
```

This advances the cursor and bumps counters under the `state.json` lock.

### Step 10 — Write a per-surface harvest log

```bash
echo "{\"ts\":\"${now}\",\"repos_scanned\":${count},\"events_written\":${written},\"events_skipped\":${skipped},\"errors\":[...]}" >> ~/work-state/harvest/github/$(date +%F).log
```

This is for debugging the harvester itself, separate from the system-wide `logs/harvests.ndjson`.

## CLI surface

```bash
# Standard daily harvest (uses cursor)
work-harvester-github

# Catch up over a longer window
work-harvester-github --since 30d
work-harvester-github --since 2026-04-01

# Webhook mode — single event passed in via stdin
echo '<github webhook payload>' | work-harvester-github --webhook

# Dry run — show what would be written, don't write
work-harvester-github --dry-run

# Specific repo only (debugging)
work-harvester-github --repo atomic47-labs/scsiwyg
```

## Errors & how this harvester handles them

| Error                                        | Behavior                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `gh` not installed                           | Fail fast with installation instructions. Don't write anything.         |
| `gh` not authenticated                       | Fail fast with `gh auth login` instructions.                            |
| GitHub API rate limit                        | Wait + retry once; if still limited, abort the run, write the cursor anyway up to the last successful repo, log the failure. |
| Repo returns 404 (deleted while scanning)    | Log to harvest/github/YYYY-MM-DD.log, skip, continue.                   |
| Single commit has malformed payload          | Log the commit's sha + the parse error, skip, continue.                 |
| `work-state log-event` returns an error      | Halt the batch, log the error, do NOT advance the cursor. Re-running will retry the same commits. |

## Webhook mode

GitHub push webhooks deliver one event payload per push. The harvester's webhook mode:

1. Parses the payload.
2. For each commit in `commits[]`, normalizes to an envelope (Step 4).
3. Calls `work-state log-event` for each.
4. Does NOT call `finalize-batch` (the cursor is owned by the scheduled harvester).
5. Does NOT write a `harvest/github/*.log` entry (those are for scheduled runs).

This means webhook events show up in state immediately; the scheduled run later "discovers" them already on disk (deterministic ids) and skips them.

## Idempotency proof

The deterministic id is:

```
github-build-{YYYY-MM-DD}-{first 6 chars of sha hash}
```

The same commit always produces the same id. `work-state log-event` checks for an existing file at `events/YYYY-MM-DD/{id}.json` and returns `{status: "duplicate"}` if found. Re-running yesterday's harvest writes zero new events.

## What this harvester does NOT do

- **Does not enrich themes.** `themes: []` is empty; `work-themes` walks events later and enriches.
- **Does not classify by stack/language.** Just records the surface evidence. Downstream skills can derive language/framework signals from `evidence.raw`.
- **Does not handle private repos differently.** `include_private` is the only knob; data lands in the same place. Local-first; nothing leaves the facility.
- **Does not track issues.** Out of scope for v1. Add as a separate type if needed.
- **Does not track GitHub Actions runs.** Out of scope; CI signal is downstream of build signal.

## Reference files

- `references/event-templates/build.json` — example normalized commit envelope
- `references/event-templates/publish.json` — example normalized release envelope
- `references/event-templates/draft.json` — example normalized PR-open envelope
- `references/gh-queries.md` — the exact `gh api` queries used, with field-by-field rationale
- `references/size-classes.md` — the size-class thresholds and why

If the reference files are missing, the SKILL.md instructions above are self-sufficient.
