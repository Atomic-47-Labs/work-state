---
name: work-harvester-gmail
description: "Harvest Gmail messages (sent + received) into `~/work-state/` as share and receive events. Use whenever the user says 'harvest gmail', 'pull my email', 'sync email work', 'gmail events', 'log my emails', 'who did I email this week', 'email harvest', 'pull recent messages', 'gmail signal', or any request to ingest Gmail activity into work-state. Also trigger when work-orchestrator's daily-routine reaches the gmail surface, or when a manual catch-up is requested with `--since`. Routes all writes through `work-state`. Idempotent — re-running is safe. Never sends or modifies email; read-only ingestion."
---

# work-harvester-gmail

Pull Gmail messages into `~/work-state/events/` as canonical envelopes. Same shape as `work-harvester-github` — only the surface differs.

## Events captured

| Gmail action                       | work-state event type | Notes                                        |
| ---------------------------------- | --------------------- | -------------------------------------------- |
| Message sent (in Sent folder)      | `share`               | Direction: outbound. One event per message.  |
| Message received (in Inbox/Primary) | `receive`             | Direction: inbound. Optional — see filtering below. |
| Draft created/updated              | `draft`               | Optional — drafts are noisy; off by default. |

## Authentication

Uses the **Gmail MCP server** (already configured in this user's environment). Auth is handled by the MCP layer; this harvester does not see credentials.

```yaml
# manifest.yaml:surfaces.gmail.auth = "gmail-mcp"
```

If the MCP server is not connected, the harvester fails fast with: "Gmail MCP not connected; configure in connectors and retry."

## Receive event filtering — important

Inbound mail is high-volume and most of it is noise (newsletters, notifications, calendar invites, automated reports). Without filtering, `receive` events overwhelm the daily digest. Default filter rules:

| Rule                                              | Action  | Rationale                            |
| ------------------------------------------------- | ------- | ------------------------------------ |
| `Category: Promotions`                            | skip    | Marketing email is noise.            |
| `Category: Social`                                | skip    | Social network notifications are noise. |
| `Category: Updates` (newsletters, receipts)       | skip    | Transactional noise.                 |
| `From: noreply@*`, `from: no-reply@*`             | skip    | One-way bots.                        |
| `From: *@github.com` notification mails           | skip    | We get the signal from `work-harvester-github` directly. |
| `From: *@slack.com` notification mails            | skip    | Same — signal from slack harvester.  |
| Calendar invites (`text/calendar` part)           | skip    | Calendar event signal lives elsewhere. |
| Direct, person-to-person mail in Primary inbox    | **keep** | Genuine signal.                      |
| Threads where the user has replied                | **keep** | If you replied, it mattered.         |

The skip rules are encoded in `references/gmail-filters.yaml` so they can be tuned without editing the SKILL.

## How a harvest runs

### Step 1 — Read configuration

Via `work-state get-manifest`:
- `surfaces.gmail.inbox_scope` (`primary` | `all`)
- `surfaces.gmail.sent_scope` (always `all`)
- `surfaces.gmail.include_drafts` (default `false`)

Via `work-state get-cursor gmail`:
- `state.json:last_harvest_at["gmail"]`

### Step 2 — Compute Gmail search query

Gmail's `q` parameter is the workhorse. Use date math so the query matches the cursor.

```
sent:    in:sent after:YYYY/MM/DD
inbox:   in:inbox category:primary -from:(noreply OR no-reply) after:YYYY/MM/DD
drafts:  in:drafts after:YYYY/MM/DD                            (only if include_drafts)
```

Date math: take the cursor timestamp, subtract 1 day for safety overlap (Gmail's `after:` is date-granularity, not timestamp), format as `YYYY/MM/DD`. The deterministic ids handle dedup.

### Step 3 — Fetch threads via Gmail MCP

Use the `Gmail:search_threads` tool, then for any thread that's interesting (has new messages since cursor), fetch full thread content with `Gmail:get_thread`.

```
search_threads(q="in:sent after:2026/04/22", max_results=100)
  → list of thread metadata
for each thread:
  if thread.last_message_date > cursor:
    get_thread(thread_id)
    for each message in thread.messages:
      if message.date > cursor:
        emit envelope
```

### Step 4 — Normalize each message to an envelope

```python
event = {
  "id": f"gmail-{event_type}-{date_part(msg.date)}-{hash(msg.id)[:6]}",
  "surface": "gmail",
  "type": "share" if direction == "outbound" else "receive",
  "timestamp": msg.date,                          # ISO-8601 UTC
  "project": attribute_project(msg),               # see below
  "themes": [],
  "evidence": {
    "thread_id": msg.thread_id,
    "message_id": msg.id,
    "direction": direction,                        # "outbound" | "inbound"
    "from": msg.from,
    "to": msg.to,                                  # array
    "cc": msg.cc,                                  # array
    "subject": msg.subject,
    "excerpt": clean_excerpt(msg.body, 200),       # first 200 chars, no quoted reply
    "has_attachments": len(msg.attachments) > 0,
    "attachment_names": [a.filename for a in msg.attachments],
    "labels": msg.label_ids,
    "in_reply_to": msg.in_reply_to,                # message_id of parent, if any
    "is_thread_starter": msg.in_reply_to is None,
  },
  "metrics": {
    "body_word_count": word_count(msg.body),
    "recipient_count": len(msg.to) + len(msg.cc),
    "is_reply": msg.in_reply_to is not None,
    "thread_position": position_in_thread(msg, thread),
  },
  "raw": msg,                                       # full Gmail API payload, untruncated
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

### Step 5 — Excerpt cleaning (privacy + signal)

`clean_excerpt`:
1. Strip the quoted reply portion (everything after `"On ... wrote:"` or `>` lines).
2. Strip signatures (everything after `--\n` or `Sent from my iPhone`).
3. Take the first 200 characters of what remains.
4. Replace email addresses found in the excerpt with `<email>` token.

The full body is preserved in `raw`; the excerpt is the human-readable summary digests pull from.

### Step 6 — Project attribution

Project attribution for email is harder than github. Heuristics in priority order:

1. **Subject line keywords** — match against `manifest:projects.*.aliases` (case-insensitive substring).
2. **Recipient domain** — if `to` includes `@atomic47labs.com` → atomic47 portfolio; `@worksona.ai` → worksona portfolio.
3. **Recurring correspondent** — track per-correspondent project history; if alice@example.com is consistently project-sunshine, attribute future mails to her there.
4. **Thread continuity** — if this is a reply, inherit the project from the thread starter.
5. **Default** — `"unsorted"`.

The recurring-correspondent heuristic is built lazily by `work-themes` from prior events; on the first harvest, it falls through to default.

### Step 7 — Write each event via `work-state log-event`

Same as github: deterministic id makes re-runs idempotent.

### Step 8 — Finalize the batch

```python
work_state.finalize_batch({
  "surface": "gmail",
  "count": written,
  "max_timestamp": max(e.timestamp for e in written_events),
  "harvester": "work-harvester-gmail",
  "harvester_version": "1.0.0",
})
```

### Step 9 — Per-surface harvest log

Append to `~/work-state/harvest/gmail/YYYY-MM-DD.log`:

```json
{"ts":"...","threads_scanned":47,"messages_seen":312,"events_written":58,"events_skipped_filter":221,"events_skipped_dup":33,"errors":[]}
```

`events_skipped_filter` counts the messages excluded by the filter rules — useful for tuning.

## CLI surface

```bash
work-harvester-gmail                              # uses cursor
work-harvester-gmail --since 30d                  # catch up
work-harvester-gmail --since 2026-04-01
work-harvester-gmail --include-drafts             # one-time include drafts
work-harvester-gmail --no-receive                 # only outbound (sent) — useful for first runs
work-harvester-gmail --dry-run                    # show what would be written
```

## Errors & how this harvester handles them

| Error                                             | Behavior                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Gmail MCP not connected                           | Fail fast; instruct user to enable the connector.                                |
| Gmail MCP rate-limited                            | Wait + retry once; if still limited, write what we have and abort.               |
| Single message has malformed payload              | Log to harvest log, skip, continue.                                              |
| `work-state log-event` returns an error           | Halt the batch, log, do NOT advance the cursor. Re-run will retry.               |

## Privacy notes — read this

Gmail evidence contains real human content. Specifically:

- **`evidence.from/to/cc`** — real email addresses.
- **`evidence.excerpt`** — first 200 chars of body text (cleaned of signatures/quotes).
- **`evidence.subject`** — the subject line as written.
- **`raw`** — the entire untruncated Gmail API payload, including full body, threading, headers, attachments metadata.

This data **never leaves `~/work-state/`** unless an export skill explicitly does so. The privacy posture is: local-first, audit-friendly, ai-readable. Downstream skills (`work-daily-digest`, `work-themes`) read excerpts and metadata; they do not need `raw` for normal operation.

If you want stricter privacy:

```yaml
# manifest.yaml:surfaces.gmail
strip_raw: true      # discard `raw` after normalizing; keep only evidence + metrics
hash_addresses: true # replace from/to with stable hashes (still groupable, not readable)
```

These knobs are off by default for full audit fidelity.

## What this harvester does NOT do

- **Does not send email.** Read-only.
- **Does not modify or delete email.** Read-only.
- **Does not infer relationship strength** (frequency-of-contact analysis is `work-metrics`).
- **Does not categorize emotional tone or content.** Themes/sentiment is `work-themes`.
- **Does not unify across email accounts.** One Gmail account at a time. Multi-account is a future enhancement.

## Reference files

- `references/event-templates/share.json` — example outbound message envelope
- `references/event-templates/receive.json` — example inbound message envelope
- `references/gmail-filters.yaml` — the skip rules; user-tunable
- `references/excerpt-cleaning.md` — the regex patterns used to strip quotes and signatures

If reference files are missing, the SKILL.md instructions above are self-sufficient.
