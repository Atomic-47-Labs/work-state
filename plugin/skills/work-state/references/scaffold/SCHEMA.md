# SCHEMA — `~/work-state/`

**The contract every skill obeys.** If a file in `work-state/` doesn't match this schema, `work-state validate` will flag it.

## Directory layout

```
~/work-state/
├── manifest.yaml                    # identity, surfaces, projects, cadence
├── state.json                       # live counters, last-harvest timestamps, lock state
├── SCHEMA.md                        # this file
├── README.md                        # tour of the facility
├── CONCURRENCY.md                   # write protocol, locking, conflict resolution
│
├── events/                          # atomic evidence — append-only, never edited
│   ├── 2026-04-29/                  # one directory per day
│   │   ├── github-build-2026-04-29-a3f9c1.json   # one file per event
│   │   ├── scsiwyg-publish-2026-04-29-7e2b04.json
│   │   ├── gmail-share-2026-04-29-1d8a55.json
│   │   └── ...
│   └── 2026-04-29.jsonl             # daily index — one line per event for fast scan
│
├── daily/                           # synthesized digests
│   ├── 2026-04-29.md                # human-readable narrative
│   └── 2026-04-29.json              # structured metrics
│
├── weekly/                          # weekly intelligence
│   ├── 2026-W17.md
│   └── 2026-W17.json
│
├── longitudinal/                    # rolling intelligence (rebuilt weekly)
│   ├── themes.json                  # memetic patterns over time
│   ├── velocity.json                # output velocity by surface/type
│   ├── projects.json                # contribution distribution
│   ├── learning-loops.json          # what's improving, what's stalling
│   └── trajectory.json              # composite over-time signal
│
├── harvest/                         # raw harvest logs by surface (for debugging)
│   ├── github/
│   │   └── 2026-04-29.log
│   ├── scsiwyg/
│   ├── gmail/
│   ├── slack/
│   ├── gdocs/
│   ├── x/
│   └── linkedin/
│
├── logs/
│   ├── activity.ndjson              # every state mutation, append-only
│   ├── harvests.ndjson              # one entry per harvest run
│   └── skills.ndjson                # which skills ran, when, with what outcome
│
└── locks/                           # advisory lockfiles (see CONCURRENCY.md)
```

## Event envelope

Every event is a JSON object with this shape:

```json
{
  "id": "github-build-2026-04-29-a3f9c1",
  "surface": "github",
  "type": "build",
  "timestamp": "2026-04-29T14:23:51Z",
  "project": "scsiwyg",
  "themes": ["headless-platform", "infrastructure-sovereignty"],
  "evidence": {
    "repo": "atomic47-labs/scsiwyg",
    "sha": "a3f9c12d4e",
    "branch": "main",
    "message": "Add MCP draft tool with channel scoping",
    "url": "https://github.com/atomic47-labs/scsiwyg/commit/a3f9c12",
    "files_changed": 8,
    "additions": 247,
    "deletions": 53
  },
  "metrics": {
    "lines_changed": 300,
    "files_changed": 8,
    "commit_size_class": "medium"
  },
  "raw": { "...": "full GitHub API response, untruncated" },
  "ingested_at": "2026-04-30T06:00:14Z",
  "harvester_version": "1.0.0"
}
```

### Required fields

| Field             | Type      | Notes                                              |
| ----------------- | --------- | -------------------------------------------------- |
| `id`              | string    | `{surface}-{type}-{date}-{hash}`. Deterministic. |
| `surface`         | enum      | `github` `scsiwyg` `gmail` `slack` `gdocs` `x` `linkedin` `manual` |
| `type`            | enum      | `build` `publish` `share` `draft` `receive` `decide` `learn` |
| `timestamp`       | ISO-8601  | When the event happened (not when ingested).      |
| `project`         | string    | One of `manifest.yaml:projects.*.id`, or `"unsorted"`. |
| `themes`          | string[]  | Memetic tags. May be empty initially; `work-themes` enriches. |
| `evidence`        | object    | Surface-specific. See "Surface evidence shapes" below. |
| `metrics`         | object    | Numeric measures. Surface-specific.               |
| `raw`             | object    | Untruncated source payload. For audit + reanalysis. |
| `ingested_at`     | ISO-8601  | When the harvester wrote the event.               |
| `harvester_version` | string  | Semver of the harvester that produced it.        |

### Event types — meaning

| Type      | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `build`   | I made something — code commit, deploy, release, build artifact. |
| `publish` | I sent something into the world — blog post, newsletter, X/LinkedIn post, public doc. |
| `share`   | I sent something to specific people — email sent, Slack message, doc shared. |
| `draft`   | I worked on something not yet published — Google Doc edits, draft posts, branches. |
| `receive` | Something arrived addressed to me — emails received, mentions, replies, DMs. |
| `decide`  | An explicit decision was logged — pulled from `project-state` decisions, conversations, commit messages tagged `[decide]`. |
| `learn`   | An explicit insight was captured — lessons-learned entries, "I learned X" notes, post-mortems. |

`decide` and `learn` are special: they're rarely auto-detected. Most come from explicit logging via `work-state log-event`.

## Surface evidence shapes

Each surface harvester produces evidence with a documented shape. The harvester skill's SKILL.md is the source of truth; this section is a summary.

### `github`
```yaml
evidence:
  repo: "owner/name"
  sha: "abc123"
  branch: "main"
  message: "commit message"
  url: "https://github.com/..."
  files_changed: 8
  additions: 247
  deletions: 53
  is_merge: false
  pr_ref: null              # if the commit is part of a PR, the PR number
```

### `scsiwyg`
```yaml
evidence:
  blog: "making-scsiwyg"
  slug: "the-headless-blog-experiment"
  title: "The Headless Blog Experiment"
  url: "https://scsiwyg.com/making-scsiwyg/the-headless-blog-experiment"
  word_count: 1820
  tags: ["headless", "platform"]
  status: "published"        # draft | published | scheduled
  published_at: "..."
```

### `gmail`
```yaml
evidence:
  thread_id: "..."
  message_id: "..."
  direction: "outbound"       # outbound | inbound
  from: "..."
  to: ["..."]
  cc: ["..."]
  subject: "..."
  excerpt: "first 200 chars of body, no quoted reply text"
  has_attachments: false
  labels: ["..."]
```

### `slack`
```yaml
evidence:
  workspace_id: "T..."
  channel_id: "C..."
  channel_name: "..."
  ts: "1234567890.123456"
  thread_ts: null
  direction: "outbound"
  text_excerpt: "..."
  reactions: []
  is_dm: false
```

### `gdocs`
```yaml
evidence:
  doc_id: "..."
  title: "..."
  url: "..."
  edit_session: { duration_minutes: 24, words_added: 412, words_removed: 88 }
  status: "draft"              # draft | shared | published
  shared_with: ["..."]
  folder_path: "..."
```

### `x`
```yaml
evidence:
  post_id: "..."
  url: "..."
  text: "...full post text..."
  word_count: 42
  is_thread: true
  thread_position: 2
  thread_total: 5
  metrics_snapshot: { likes: null, reposts: null }    # X API is paid; null on manual export
```

### `linkedin`
```yaml
evidence:
  post_urn: "..."
  url: "..."
  text: "...full post text..."
  word_count: 312
  has_image: true
  metrics_snapshot: { reactions: null, comments: null, impressions: null }
```

### `manual` (catch-all for `decide` / `learn` events)
```yaml
evidence:
  source: "conversation" | "lessons-learned" | "manual-entry"
  context: "free-form description of where this came from"
  content: "the decision or learning itself"
  reference_url: "..."          # optional link to context
```

## State.json

```json
{
  "schema_version": "1.0",
  "first_harvest_at": "2026-04-29T06:00:00Z",
  "last_harvest_at": {
    "github": "2026-04-29T06:00:14Z",
    "scsiwyg": "2026-04-29T06:01:02Z",
    "gmail": null,
    "slack": null,
    "gdocs": null,
    "x": null,
    "linkedin": null
  },
  "last_digest_at": null,
  "last_weekly_at": null,
  "last_longitudinal_at": null,
  "counters": {
    "events_total": 0,
    "events_by_surface": { "github": 0, "scsiwyg": 0 },
    "events_by_type": { "build": 0, "publish": 0 },
    "events_by_project": { "scsiwyg": 0 }
  },
  "active_locks": []
}
```

`last_harvest_at` per surface is the **cursor** harvesters use to know where to resume — they pull events with `timestamp > last_harvest_at[surface]`.

## Daily digest (`daily/YYYY-MM-DD.json`)

```json
{
  "date": "2026-04-29",
  "generated_at": "2026-04-30T07:30:00Z",
  "event_count": 47,
  "by_surface": { "github": 12, "scsiwyg": 2, "gmail": 18, "slack": 14, "gdocs": 1 },
  "by_type": { "build": 12, "publish": 2, "share": 30, "draft": 3 },
  "by_project": { "scsiwyg": 18, "project-sunshine": 8, "unsorted": 21 },
  "themes_top": [
    { "theme": "headless-platform", "weight": 0.32 },
    { "theme": "sovereignty", "weight": 0.18 }
  ],
  "highlights": [
    { "type": "publish", "summary": "Published 'Methodology as Infrastructure' on making-scsiwyg" },
    { "type": "build", "summary": "Shipped 12 commits to scsiwyg main" }
  ]
}
```

The matching `daily/YYYY-MM-DD.md` is the human-readable narrative version, generated from the same JSON.

## Activity log entry

```json
{"ts": "2026-04-30T06:00:14Z", "actor": "work-harvester-github", "event": "events.batch.ingested", "surface": "github", "count": 12, "summary": "Ingested 12 commits from 3 repos"}
```

## Ground rules

1. **Events are immutable.** Once written, never edit an event file. Corrections go in via a new event with `type: "correction"` referencing the original.
2. **All writes flow through `work-state`.** No skill mutates `work-state/` directly except `work-state` itself.
3. **Per-day directories.** Events are filed under `events/YYYY-MM-DD/` to keep directories from getting absurdly large.
4. **Daily JSONL is regenerable.** If `events/2026-04-29.jsonl` is lost, `work-state rebuild-index 2026-04-29` recreates it from the per-event JSON files.
5. **Schema versions are explicit.** Every file declares its `schema_version`. Migrations are versioned.

## What this schema does NOT cover

- **Theme inference rules** — that's `work-themes`'s job.
- **Project attribution rules** — `work-state` accepts whatever the harvester decided; `work-themes` and `work-metrics` may reattribute later via correction events.
- **Privacy / redaction policy** — covered separately in `PRIVACY.md` (TBD). Default: `raw` payloads stay local; nothing leaves `~/work-state/` unless an export skill does so explicitly.
