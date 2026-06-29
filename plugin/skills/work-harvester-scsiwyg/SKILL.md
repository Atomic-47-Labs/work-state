---
name: work-harvester-scsiwyg
description: "Harvest scsiwyg blog events (publish, draft) into ~/work-state/events/ as canonical envelopes. Reads all owned blogs via the scsiwyg MCP, filters posts since the cursor, normalises to the work-state event envelope, writes flat files, and advances the cursor. Trigger: /work-harvester-scsiwyg"
---

# work-harvester-scsiwyg — pattern reference

Follows the same shape as `work-harvester-github`: read cursor → fetch from surface → normalize to envelope → dedup-by-id → write each → finalize-batch.

## Purpose

Pull blog activity from scsiwyg into `~/work-state/events/` as canonical envelopes.

| scsiwyg action                   | work-state event type | Notes                                          |
| -------------------------------- | --------------------- | ---------------------------------------------- |
| Post published (visibility=public) | `publish`           | One event per post. Captures the publication moment. |
| Post in draft / private          | `draft`               | One event per draft. Captures the creative workstream. |
| Newsletter sent                  | `share`               | One event per send. Captures distribution reach. |

## Authentication

Uses the `scsiwyg` MCP server (`mcp__scsiwyg__*` tools). No additional auth steps — the MCP is already connected.

## How a harvest runs

### Step 1 — Read the cursor

Read `~/work-state/state.json`:
```
cursor = state.last_harvest_at["scsiwyg"] ?? "2026-01-01T00:00:00Z"
```
If the key is missing, default to 30 days ago.

### Step 2 — Discover all owned sites

Call:
```
mcp__scsiwyg__list_my_sites()
```

Returns an array of site objects:
```json
{
  "username": "worksona",
  "title": "Worksona",
  "postCount": 58,
  "blogUrl": "/worksona",
  "role": "owner",
  "isDefault": false,
  "createdAt": "2026-04-17T05:01:34.922Z"
}
```

Only process sites where `role == "owner"`. Skip community-contributed blogs.

### Step 3 — For each site, list all posts (including unpublished)

```
mcp__scsiwyg__list_posts(username, includeUnpublished: true)
```

Returns posts with shape:
```json
{
  "slug": "my-post-slug",
  "title": "Post Title",
  "visibility": "public",
  "publishedAt": "2026-04-20T10:00:00.000Z",
  "tags": ["tag1", "tag2"],
  "createdAt": "2026-04-17T06:44:02.248Z"
}
```

Filter posts where:
- `publishedAt > cursor`  (for `publish` events)
- OR `createdAt > cursor AND visibility != "public"`  (for `draft` events)

### Step 4 — Project attribution by blog username

Use this map (derived from manifest.yaml):

```python
BLOG_PROJECT = {
    "worksona":         "worksona",
    "project-state":    "project-state",
    "quality-controls": "aimqc-office-app",   # AIMQC portfolio blog
    "emily":            "emilyos",
    "stonemaps":        "stone-maps",
    "atlas":            "atlas",
    "claude-skills":    "worksona",            # claude skills library → worksona
    "the-scsiwyg-blog": "scsiwyg",
    "making-scsiwyg":   "scsiwyg",
    "oaira-mr":         "oaira",
    "ai26-10":          "crush-dynamics",
    "daanaa":           "daanaa",
    "emporium":         "emporium",
    "commit-and-push":  "worksona",
    "nutabu":           "nutabu",
    "david":            "unsorted",            # personal/misc
}
```

For any username not in this map → `"unsorted"`.

### Step 5 — Normalize each post to an envelope

**For a published post:**

```python
event = {
  "id": f"scsiwyg-publish-{date_part(post.publishedAt)}-{username}-{slug[:24]}",
  "surface": "scsiwyg",
  "type": "publish",
  "timestamp": post.publishedAt,
  "project": BLOG_PROJECT.get(username, "unsorted"),
  "themes": post.tags,          # tags map directly to themes
  "evidence": {
    "blog": username,
    "slug": post.slug,
    "title": post.title,
    "url": f"https://www.scsiwyg.com/{username}/{post.slug}",
    "visibility": post.visibility,
    "tags": post.tags,
    "tag_count": len(post.tags),
    "created_at": post.createdAt,
  },
  "metrics": {
    "tag_count": len(post.tags),
    "word_count": 0,        # not available from list_posts; enrich via get_post if needed
  },
  "raw": post,
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

**For a draft/private post:**

Same shape but:
- `"type": "draft"`
- `"timestamp": post.createdAt`
- `"id": f"scsiwyg-draft-{date_part(post.createdAt)}-{username}-{slug[:24]}"`

### Step 6 — Newsletter sends as `share` events

After processing posts, call:
```
mcp__scsiwyg__get_send_stats(username)
```

For each entry in `recentSends` where `sentAt > cursor`:

```python
event = {
  "id": f"scsiwyg-share-{date_part(send.sentAt)}-{username}-{send.postSlug[:24]}",
  "surface": "scsiwyg",
  "type": "share",
  "timestamp": send.sentAt,
  "project": BLOG_PROJECT.get(username, "unsorted"),
  "themes": [],
  "evidence": {
    "blog": username,
    "post_slug": send.postSlug,
    "recipient_count": send.recipientCount,
    "open_rate": send.openRate,
    "click_rate": send.clickRate,
  },
  "metrics": {
    "recipients": send.recipientCount,
    "open_rate": send.openRate,
  },
  "raw": send,
  "ingested_at": now_iso(),
  "harvester_version": "1.0.0",
}
```

If `get_send_stats` returns `recentSends: []`, skip quietly.

### Step 7 — Write each event

For each normalized event:

```python
date_dir = f"~/work-state/events/{date_part(event.timestamp)}/"
ev_path  = f"{date_dir}{event.id}.json"

if os.path.exists(ev_path):
    skipped += 1
    continue

write_json(ev_path, event)
written += 1
```

### Step 8 — Finalize: advance cursor + update counters

Write to `state.json` (acquire file lock first):

```python
state.last_harvest_at["scsiwyg"] = max(event.timestamp for event in written_events)
state.counters.events_total          += written
state.counters.events_by_surface["scsiwyg"] += written
state.counters.events_by_type["publish"]    += publish_count
state.counters.events_by_type["draft"]      += draft_count
state.counters.events_by_type["share"]      += share_count
for project, count in by_project.items():
    state.counters.events_by_project[project] += count
```

### Step 9 — Write harvest log

```bash
echo '{"ts":"...","sites_scanned":N,"posts_scanned":N,"events_written":W,"events_skipped":S,"errors":[...]}' \
  >> ~/work-state/harvest/scsiwyg/$(date +%F).log
```

## Execution — how to run this skill

This skill is implemented as a live Claude session (not a shell script). When invoked:

1. Call `mcp__scsiwyg__list_my_sites` to get all sites.
2. For each owned site, call `mcp__scsiwyg__list_posts(username, includeUnpublished: true)`.
3. Filter posts against the cursor (read from `~/work-state/state.json`).
4. Normalize each qualifying post to an envelope.
5. Write event files to `~/work-state/events/YYYY-MM-DD/{id}.json` using the Bash/Write tools.
6. Call `mcp__scsiwyg__get_send_stats` for each site and process any newsletter sends.
7. Update `state.json` counters and cursor using Bash + Python.
8. Print summary.

**Important:** Use the `Bash` tool with Python to write files and update state — do not call any tools that would push data externally. All writes stay local.

## CLI surface

```bash
# Standard harvest (uses cursor)
/work-harvester-scsiwyg

# Backfill from a specific date
/work-harvester-scsiwyg --since 2026-01-01

# Dry run — show what would be written, don't write
/work-harvester-scsiwyg --dry-run

# Single blog only
/work-harvester-scsiwyg --blog worksona
```

## Idempotency proof

The deterministic id is:
```
scsiwyg-{type}-{YYYY-MM-DD}-{username}-{slug[:24]}
```

The same post always produces the same id. If the event file already exists, the post is skipped (`status: duplicate`). Re-running the same day's harvest writes zero new events.

## Event ID examples

```
scsiwyg-publish-2026-04-20-worksona-worksona-first-principles
scsiwyg-publish-2026-04-17-quality-controls-field-inspection-ai
scsiwyg-draft-2026-04-15-emily-companion-memory-arch
scsiwyg-share-2026-04-20-worksona-worksona-first-principles
```

## Project attribution — blog → project

| Blog username      | project id         | Portfolio       |
| ------------------ | ------------------ | --------------- |
| worksona           | worksona           | worksona        |
| project-state      | project-state      | worksona        |
| quality-controls   | aimqc-office-app   | aimqc           |
| emily              | emilyos            | worksona        |
| stonemaps          | stone-maps         | personal        |
| atlas              | atlas              | market-research |
| claude-skills      | worksona           | worksona        |
| the-scsiwyg-blog   | scsiwyg            | atomic47        |
| making-scsiwyg     | scsiwyg            | atomic47        |
| oaira-mr           | oaira              | market-research |
| ai26-10            | crush-dynamics     | atomic47        |
| daanaa             | daanaa             | atomic47        |
| emporium           | emporium           | personal        |
| commit-and-push    | worksona           | worksona        |
| nutabu             | nutabu             | nutabu          |
| david              | unsorted           | —               |

## Error handling

| Error                            | Behavior                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| MCP tool unavailable             | Fail fast; print "scsiwyg MCP not connected". Don't write anything. |
| Site returns empty posts         | Log site + count=0; continue to next site.                        |
| Post has null `publishedAt`      | Use `createdAt` as fallback timestamp.                            |
| `state.json` missing             | Create minimal state; cursor defaults to 30 days ago.             |
| File write fails                 | Log error; do NOT advance cursor; re-run will retry.              |

## What this harvester does NOT do

- **Does not fetch full post body.** `list_posts` gives metadata only. `get_post` is available but adds one API call per post — skip unless word_count enrichment is explicitly requested.
- **Does not harvest wiki pages.** Wiki edits are not yet part of the event envelope schema.
- **Does not track view counts.** Views are not surfaced by `list_posts`; available via `get_tag_map` in aggregate only.
- **Does not push to any external system.** Local-first; all writes stay in `~/work-state/`.
