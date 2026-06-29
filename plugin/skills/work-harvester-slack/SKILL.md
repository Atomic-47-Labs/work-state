---
name: work-harvester-slack
description: "Harvest Slack messages (sent + received in subscribed channels and DMs) into `~/work-state/` as share and receive events. Use whenever the user says 'harvest slack', 'pull my slack', 'sync slack work', 'slack events', 'log my slack messages', 'what did I post in slack this week', 'slack harvest', 'pull recent messages from slack', 'slack signal', or any request to ingest Slack activity into work-state. Also trigger when work-orchestrator's daily-routine reaches the slack surface, or when a manual catch-up is requested with `--since`. Routes all writes through `work-state`. Idempotent — re-running is safe. Never sends Slack messages; read-only ingestion."
---

# work-harvester-slack

Pull Slack messages into `~/work-state/events/` as canonical envelopes.

## Events captured

| Slack action                           | work-state event type | Notes                                          |
| -------------------------------------- | --------------------- | ---------------------------------------------- |
| Message posted by user (any channel)   | `share`               | Direction: outbound. One event per message.    |
| Message in a thread the user started   | `share` or `receive`  | Outbound = share, inbound = receive.           |
| DM received                            | `receive`             | Direction: inbound. One-on-one or group DM.    |
| @mention of user in a channel          | `receive`             | Even if they didn't reply.                     |
| Reaction added by user                 | (skipped by default)  | Optional; reactions are noisy. See knobs.      |

## Authentication

Uses the **Slack MCP server** (already configured). Auth handled by MCP layer.

```yaml
# manifest.yaml:surfaces.slack.auth = "slack-mcp"
```

If the MCP server is not connected, fail fast: "Slack MCP not connected; configure in connectors."

## Channel-scope filtering

Slack volume can be enormous. Channel-scope is the primary noise control.

| Setting                     | Behavior                                                    |
| --------------------------- | ----------------------------------------------------------- |
| `channels_scope: subscribed` | Only channels the user has joined. (Default.)              |
| `channels_scope: starred`   | Only channels the user has starred.                          |
| `channels_scope: all_accessible` | Everything the user can read. (Heavy; first runs only.) |

Plus per-channel exclusions in `references/slack-channels.yaml`:

```yaml
exclude_channels:
  - "#general"            # too noisy
  - "#random"
  - "#announcements-*"    # glob patterns ok
include_dms: true
include_group_dms: true
include_mentions_in_excluded: true   # @mentions are signal even in excluded channels
```

## How a harvest runs

### Step 1 — Read configuration

Via `work-state get-manifest`:
- `surfaces.slack.workspaces` (array; harvest each)
- `surfaces.slack.channels_scope`
- Channel exclusions from references file

Via `work-state get-cursor slack`:
- `state.json:last_harvest_at["slack"]`

### Step 2 — Discover channels per workspace

Use `Slack:slack_search_channels` to enumerate joined/starred channels in scope. Apply exclusion rules. Build the channel list.

### Step 3 — For each channel, read messages since cursor

Use `Slack:slack_read_channel` with a time bound. Slack message timestamps are floats like `"1714389612.123456"`; convert to ISO-8601 for the envelope, but keep the original `ts` in evidence (it's the canonical Slack id).

```
read_channel(channel_id, oldest=cursor_ts, limit=200, paginate=true)
  → list of messages
for each message:
  if message.user == self.user_id:
    direction = "outbound"
    event_type = "share"
  else:
    direction = "inbound"
    event_type = "receive"
  emit envelope
```

### Step 4 — Read DMs and group DMs

Use `Slack:slack_search_users` once to confirm self user_id, then iterate DM channel ids the user participates in.

### Step 5 — Read mentions

Use `Slack:slack_search_public` (or `slack_search_public_and_private`) with query `@<self_user_id>` and time bound. This catches mentions in channels the user hasn't joined but can read.

### Step 6 — Normalize each message to an envelope

```python
event = {
  "id": f"slack-{event_type}-{date_part(msg.ts)}-{hash(msg.workspace + msg.channel + msg.ts)[:6]}",
  "surface": "slack",
  "type": event_type,                              # "share" or "receive"
  "timestamp": iso_from_slack_ts(msg.ts),           # convert float ts to ISO-8601 UTC
  "project": attribute_project(msg, channel),
  "themes": [],
  "evidence": {
    "workspace_id": msg.team,
    "workspace_name": workspace_name,
    "channel_id": msg.channel,
    "channel_name": channel_name,
    "ts": msg.ts,                                   # canonical Slack id
    "thread_ts": msg.thread_ts,                     # null if top-level
    "direction": direction,
    "from_user_id": msg.user,
    "from_user_name": user_name,                    # resolved via slack_read_user_profile
    "text_excerpt": clean_excerpt(msg.text, 200),   # first 200 chars, mentions resolved
    "reactions": [r.name for r in msg.reactions],   # array of emoji names, e.g. ["+1", "rocket"]
    "reaction_count": sum(r.count for r in msg.reactions),
    "is_dm": channel.is_im or channel.is_mpim,
    "is_thread_starter": msg.thread_ts is None or msg.thread_ts == msg.ts,
    "is_reply_in_thread": msg.thread_ts is not None and msg.thread_ts != msg.ts,
    "is_mention": is_mention_of_self(msg),
    "has_files": len(msg.files or []) > 0,
    "file_names": [f.name for f in msg.files or []],
  },
  "metrics": {
    "text_word_count": word_count(msg.text),
    "reaction_count": sum(r.count for r in msg.reactions),
    "thread_reply_count": msg.reply_count or 0,
    "channel_active_member_count": channel.num_members,
  },
  "raw": msg,
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

### Step 7 — Excerpt cleaning

`clean_excerpt`:
1. Resolve `<@U12345>` mentions to `@username`.
2. Resolve `<#C12345|channelname>` to `#channelname`.
3. Resolve `<https://link|text>` to `text`.
4. Strip leading/trailing whitespace.
5. Take first 200 chars.

Full text in `raw`.

### Step 8 — Project attribution

Heuristics in priority order:

1. **Channel name** — `#sunshine-team` → `project-sunshine`; `#scsiwyg-eng` → `scsiwyg`. Match against `manifest:projects.*.aliases`.
2. **Workspace** — if the workspace itself is project-specific (e.g., a customer workspace), use a per-workspace default.
3. **Thread continuity** — replies inherit from thread starter.
4. **DM correspondent** — recurring DM partner with stable project history (built lazily by `work-themes`).
5. **Default** — `"unsorted"`.

### Step 9 — Write each event via `work-state log-event`

Same as gmail/github. Idempotent.

### Step 10 — Finalize the batch

```python
work_state.finalize_batch({
  "surface": "slack",
  "count": written,
  "max_timestamp": max_iso_ts,
  "harvester": "work-harvester-slack",
  "harvester_version": "1.0.0",
})
```

### Step 11 — Per-surface harvest log

Append to `~/work-state/harvest/slack/YYYY-MM-DD.log`:

```json
{"ts":"...","workspaces":2,"channels_scanned":18,"messages_seen":847,"events_written":412,"events_skipped_filter":402,"events_skipped_dup":33,"errors":[]}
```

## CLI surface

```bash
work-harvester-slack                              # uses cursor
work-harvester-slack --since 7d
work-harvester-slack --workspace T123ABC          # one workspace only
work-harvester-slack --include-reactions          # include reaction events
work-harvester-slack --no-receive                 # only outbound (your messages)
work-harvester-slack --dry-run
```

## Errors & how this harvester handles them

| Error                                             | Behavior                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Slack MCP not connected                           | Fail fast.                                                                       |
| Workspace token expired                           | Skip that workspace, log error, continue with others.                            |
| Slack rate-limit (Tier 3)                         | Wait + retry once; if still limited, save progress and abort.                    |
| Channel deleted/archived mid-scan                 | Log, skip, continue.                                                             |
| Single message has malformed payload              | Log, skip, continue.                                                             |
| `work-state log-event` returns an error           | Halt, log, do NOT advance cursor.                                                |

## Privacy notes

Slack content is sensitive. Same posture as gmail:

- `evidence.text_excerpt` is the cleaned excerpt; full text in `raw`.
- DMs are captured by default — they ARE work signal — but they're flagged with `is_dm: true` so downstream skills can treat them differently (e.g., redact in shared digests).
- Local-first; nothing leaves the facility unless an export skill explicitly does so.

```yaml
# manifest.yaml:surfaces.slack
strip_raw: true        # discard `raw` after normalizing
hash_user_ids: true    # replace user_ids with stable hashes
exclude_dms: true      # skip DMs entirely
```

Off by default.

## What this harvester does NOT do

- **Does not send Slack messages.** Read-only.
- **Does not modify or delete messages.** Read-only.
- **Does not analyze sentiment.** Themes/sentiment is `work-themes`.
- **Does not measure response time** (response-latency analysis is `work-metrics`).
- **Does not handle Slack Connect (externally shared) channels specially** — they're treated like any other channel; the schema flag `is_external` could be added later if needed.

## Reference files

- `references/event-templates/share.json` — example outbound message envelope
- `references/event-templates/receive.json` — example inbound DM/mention envelope
- `references/slack-channels.yaml` — channel exclusion rules
- `references/excerpt-cleaning.md` — mention/link resolution rules

If reference files are missing, the SKILL.md instructions above are self-sufficient.
