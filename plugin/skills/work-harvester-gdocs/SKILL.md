---
name: work-harvester-gdocs
description: "Harvest Google Docs activity (edits, creates, shares) into `~/work-state/` as draft, publish, and share events. Use whenever the user says 'harvest gdocs', 'harvest google docs', 'pull my docs', 'sync docs work', 'gdocs events', 'log my doc edits', 'what did I write this week', 'gdocs harvest', 'pull recent docs', or any request to ingest Google Docs activity into work-state. Also trigger when work-orchestrator's daily-routine reaches the gdocs surface, or when a manual catch-up is requested with `--since`. Routes all writes through `work-state`. Idempotent — re-running is safe. Read-only ingestion."
---

# work-harvester-gdocs

Pull Google Docs activity into `~/work-state/events/` as canonical envelopes.

## Why this surface is different

Docs are not events; they're long-lived editable artifacts. A single doc may be edited across dozens of sessions over weeks. The harvester's job is to convert continuous editing into **discrete events** that match the work-state envelope.

The strategy: **one event per "edit session" per day per doc**, plus separate events for **creation** (`draft` first-write), **first share** (`share`), and **public publication** (`publish` — when the doc is set to "anyone with the link" or similar).

## Events captured

| Activity                                   | work-state event type | Notes                                                |
| ------------------------------------------ | --------------------- | ---------------------------------------------------- |
| Doc created by user                        | `draft`               | One event per new doc.                                |
| Edit session (user edited the doc today)   | `draft`               | One event per doc per day with edits ≥ threshold.    |
| Doc shared with someone (permission added) | `share`               | One event per share action.                           |
| Doc made public / link-share-enabled       | `publish`             | One event per publication.                            |

This means a doc that's edited daily for two weeks produces ~14 `draft` events with progressively richer metrics (word counts climbing). That's exactly what we want for longitudinal intelligence — the trajectory of a document is itself signal.

## Authentication

Uses the **Google Drive MCP server** (already configured). Auth handled by MCP layer.

```yaml
# manifest.yaml:surfaces.gdocs.auth = "gdrive-mcp"
```

If the MCP server is not connected, fail fast: "Google Drive MCP not connected; configure in connectors."

## Scope

| Setting                       | Behavior                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| `folders_scope: all_owned`    | All docs the user owns. (Default.)                          |
| `folders_scope: starred`      | Only starred docs.                                          |
| `folders_scope: list`         | Specific folder IDs in `references/gdocs-folders.yaml`.     |

Plus exclusion rules in `references/gdocs-excludes.yaml` (e.g., skip docs in a "Personal" folder, skip docs whose title matches a pattern).

## How a harvest runs

### Step 1 — Read configuration

Via `work-state get-manifest`:
- `surfaces.gdocs.folders_scope`
- `surfaces.gdocs.min_edit_words` — threshold for what counts as a meaningful edit session (default: 10 words added or removed)

Via `work-state get-cursor gdocs`:
- `state.json:last_harvest_at["gdocs"]`

### Step 2 — Discover docs in scope

Use `Google Drive:list_recent_files` (sorted by `modifiedTime desc`) with a time-bounded query. For broader scope, use `Google Drive:search_files` with:

```
mimeType='application/vnd.google-apps.document' and modifiedTime > '2026-04-22T00:00:00Z'
```

Filter to docs `'me' in owners` for owned scope.

### Step 3 — For each doc, determine what changed since cursor

For each doc with `modifiedTime > cursor`:

1. Fetch metadata via `Google Drive:get_file_metadata`.
2. Check if the doc was created since cursor → emit `draft` event with `subtype: "created"`.
3. Compute today's edit-session footprint:
   - Use Drive's `revisions` API (via `Google Drive` MCP) if accessible, OR
   - Compare current word count vs. the last-recorded word count for this doc id (stored in `~/work-state/harvest/gdocs/word-count-cache.json`).
4. If word delta ≥ threshold → emit `draft` event with `subtype: "edit-session"`.
5. Check permissions via `Google Drive:get_file_permissions`. If new permissions appeared since cursor → emit `share` events for each new principal.
6. Check sharing setting. If changed to "Anyone with the link" since cursor → emit `publish` event.

### Step 4 — Word-count cache

Maintain a small cache to compute deltas without storing every revision:

```
~/work-state/harvest/gdocs/word-count-cache.json
{
  "doc-id-abc123": {
    "title": "Project Sunshine — Cost Model v3",
    "last_word_count": 4218,
    "last_observed": "2026-04-29T06:01:14Z"
  },
  "doc-id-def456": { ... }
}
```

The cache is rebuildable from on-disk events; if lost, the next harvest just records the current word count and starts deltas from there.

### Step 5 — Normalize each emitted activity to an envelope

**Edit session:**

```python
event = {
  "id": f"gdocs-draft-{date_part(now)}-{hash(doc_id + date)[:6]}",
  "surface": "gdocs",
  "type": "draft",
  "timestamp": doc.modified_time,
  "project": attribute_project(doc.title, doc.folder_path),
  "themes": [],
  "evidence": {
    "doc_id": doc.id,
    "title": doc.name,
    "url": doc.web_view_link,
    "subtype": "edit-session",                # "created" | "edit-session" | "renamed"
    "edit_session_date": today_date,
    "current_word_count": current_wc,
    "previous_word_count": cache_wc,
    "words_added_estimate": max(0, current_wc - cache_wc),
    "words_removed_estimate": max(0, cache_wc - current_wc),
    "owner": doc.owner_email,
    "folder_path": doc.folder_path,
    "shared_with_count": doc.shared_with_count,
  },
  "metrics": {
    "current_word_count": current_wc,
    "word_delta": current_wc - cache_wc,
    "absolute_word_change": abs(current_wc - cache_wc),
  },
  "raw": doc,
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

**Share event:**

```python
event = {
  "id": f"gdocs-share-{date_part(now)}-{hash(doc_id + principal)[:6]}",
  "surface": "gdocs",
  "type": "share",
  "timestamp": permission.created_time,
  "project": attribute_project(doc.title, doc.folder_path),
  "evidence": {
    "doc_id": doc.id,
    "title": doc.name,
    "url": doc.web_view_link,
    "shared_with": permission.email_address,    # "alice@example.com" or "anyone"
    "share_role": permission.role,              # "reader" | "commenter" | "writer"
    "share_type": permission.type,              # "user" | "group" | "domain" | "anyone"
  },
  "metrics": {
    "current_word_count": current_wc,
  },
  "raw": permission,
  ...
}
```

**Publish event** (link-sharing enabled):

```python
event = {
  "id": f"gdocs-publish-{date_part(now)}-{hash(doc_id)[:6]}",
  "surface": "gdocs",
  "type": "publish",
  "timestamp": permission_change_time,
  "project": attribute_project(...),
  "evidence": {
    "doc_id": doc.id,
    "title": doc.name,
    "url": doc.web_view_link,
    "publication_scope": "anyone-with-link",      # or "anyone-can-find"
    "current_word_count": current_wc,
  },
  ...
}
```

### Step 6 — Project attribution

1. **Folder path** — if the doc lives in `WORKSONA/sunshine/` or similar, attribute by folder.
2. **Title** — match against `manifest:projects.*.aliases`.
3. **Default** — `"unsorted"`.

### Step 7 — Write events via `work-state log-event`

Same pattern as other harvesters. The id encodes date + doc_id, so re-running on the same day with the same doc state produces a duplicate (skipped). New edit session tomorrow → new event.

### Step 8 — Update word-count cache

After emitting events for a doc, update the cache with the new `last_word_count` and `last_observed`. This is a write to `~/work-state/harvest/gdocs/word-count-cache.json` — atomic rename, no lock (single-writer assumed since gdocs harvester doesn't run concurrently with itself).

### Step 9 — Finalize the batch

```python
work_state.finalize_batch({
  "surface": "gdocs",
  "count": written,
  "max_timestamp": max_ts,
  "harvester": "work-harvester-gdocs",
  "harvester_version": "1.0.0",
})
```

### Step 10 — Per-surface harvest log

Append to `~/work-state/harvest/gdocs/YYYY-MM-DD.log`:

```json
{"ts":"...","docs_seen":47,"edit_sessions":12,"creates":2,"shares":4,"publishes":0,"events_skipped_threshold":18,"errors":[]}
```

`events_skipped_threshold` counts docs where the word delta was below the meaningful-edit threshold.

## CLI surface

```bash
work-harvester-gdocs                              # uses cursor
work-harvester-gdocs --since 14d
work-harvester-gdocs --folder folder-id-abc       # one folder only
work-harvester-gdocs --min-edit-words 50          # tighter threshold
work-harvester-gdocs --rebuild-cache              # rebuild word-count cache from events
work-harvester-gdocs --dry-run
```

## Errors & how this harvester handles them

| Error                                             | Behavior                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Drive MCP not connected                           | Fail fast.                                                                       |
| Drive API rate-limit                              | Wait + retry once; abort with progress saved if still limited.                   |
| Doc fetch returns 403/404                         | Log to harvest log, skip, continue.                                              |
| Word-count cache corrupted                        | Rebuild from events (`--rebuild-cache`); record this run as cold-start (no deltas). |
| Single revision has malformed payload             | Log, skip, continue.                                                             |
| `work-state log-event` returns an error           | Halt batch, log, do NOT advance cursor.                                          |

## Privacy notes

Docs can contain very sensitive content. Same posture as gmail/slack:

- `evidence.title` and `evidence.url` always captured.
- **Document body content is NOT captured** by default — only word counts and metadata. This is a deliberate choice; bodies are large, sensitive, and not necessary for the work-state's signal.
- If the user wants body excerpts (e.g., the first paragraph for the digest), enable:

```yaml
# manifest.yaml:surfaces.gdocs
capture_excerpt: true        # capture first 500 chars of body
capture_full_body: false     # never default-on; manual flag for archival use
```

The Drive MCP's `read_file_content` tool fetches body when needed.

## What this harvester does NOT do

- **Does not capture comments or suggestions.** Comments are signal, but they're a different surface; v2 might add a `gdocs-comment` event type.
- **Does not capture revision history detail** (per-keystroke). Just the daily roll-up.
- **Does not detect specific edits** (which paragraph changed). Just word-count deltas.
- **Does not track Google Sheets or Slides separately.** Could be added — different mime types, different metrics. v1 = docs only.
- **Does not modify any docs.** Read-only.

## Reference files

- `references/event-templates/draft-edit-session.json` — example edit-session envelope
- `references/event-templates/draft-created.json` — example create envelope
- `references/event-templates/share.json` — example share envelope
- `references/event-templates/publish.json` — example publish envelope
- `references/gdocs-excludes.yaml` — folder/title exclusion rules

If reference files are missing, the SKILL.md instructions above are self-sufficient.
