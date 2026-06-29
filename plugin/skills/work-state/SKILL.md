---
name: work-state
description: "The shared memory of David's personal work intelligence facility. Read, write, or validate `~/work-state/` — manifest, surfaces config, events, daily digests, weekly reports, longitudinal intelligence, activity log. Trigger on 'log this event', 'record a build/publish/share/draft', 'tail the activity log', 'check work-state health', 'validate work-state', 'list events', 'count events', 'work-state status', 'last harvest cursor', 'rebuild index', or any request that reads or writes `~/work-state/`. Also trigger automatically whenever another work-* skill (orchestrator, harvester-*, daily-digest, weekly-report, themes, metrics, longitudinal, planner, dashboard) needs to read or write state — they route through this one. Init a new facility if `~/work-state/manifest.yaml` doesn't exist."
---

# work-state — the memory layer

## Purpose

Every `work-*` skill depends on this one. `work-state` is the *only* skill that reads and writes `~/work-state/` directly; every other skill expresses intent ("log a github build event", "advance the gmail cursor", "record a digest") and this skill enforces schema, concurrency, and logging.

Without this skill, evidence files drift from the index, two harvesters running concurrently clobber each other's cursors, and the activity log stops being trustworthy.

## Finding the facility

The facility lives at `~/work-state/`. There is exactly one per machine.

```bash
WORK_STATE="${HOME}/work-state"
test -f "${WORK_STATE}/manifest.yaml" || echo "Not initialized"
```

If it doesn't exist:
- If the user asked a read-only question, say so and stop.
- If the user asked to log/harvest, offer to run `init` (see Operations → init below).

## Schema

The canonical schema lives in `~/work-state/SCHEMA.md`. This skill validates against that file. Every event must have:

- `id` — `{surface}-{type}-{date}-{hash}`, deterministic
- `surface` — one of the keys in `manifest.yaml:surfaces`
- `type` — `build` | `publish` | `share` | `draft` | `receive` | `decide` | `learn`
- `timestamp` — ISO-8601 UTC, when the event happened
- `project` — one of `manifest.yaml:projects.*.id`, or `"unsorted"`
- `themes` — array (may be empty initially; `work-themes` enriches later)
- `evidence` — surface-specific structured proof
- `metrics` — surface-specific numeric measures
- `raw` — full untruncated source payload
- `ingested_at` — ISO-8601 UTC, when the harvester wrote it
- `harvester_version` — semver of the harvester

Refuse to write any event missing required fields.

## Operations

### `init` — first-time setup

Create `~/work-state/` with the directory tree from SCHEMA.md, plus seed files:

```
~/work-state/
├── manifest.yaml      ← copy from skill template; user fills in surface auth
├── state.json         ← empty initial counters
├── SCHEMA.md          ← copy from skill template
├── README.md          ← copy from skill template
├── CONCURRENCY.md     ← copy from skill template
├── events/
├── daily/
├── weekly/
├── longitudinal/
├── harvest/{github,scsiwyg,gmail,slack,gdocs,x,linkedin}/
├── logs/
└── locks/
```

The skill carries reference copies of `manifest.yaml`, `SCHEMA.md`, `README.md`, `CONCURRENCY.md` under `references/scaffold/` and copies them into place. After init, log `facility.initialized` to `logs/activity.ndjson`.

### Read operations (no locking needed)

**get-manifest** → return parsed `manifest.yaml`.

**get-state** → return parsed `state.json`.

**get-cursor** `surface` → return `state.json:last_harvest_at[surface]`.

**get-event** `id` → look up by id, return parsed event JSON. The id encodes the date, so the file is at `events/YYYY-MM-DD/{id}.json`.

**list-events** with optional filters: `since`, `until`, `surface`, `type`, `project`, `theme`, `limit`. Walks `events/YYYY-MM-DD/` directories in the relevant date range, optionally filters in memory, returns array.

**count-events** with same filters as list-events. Returns `{total, by_surface, by_type, by_project}`.

**tail-activity** `n=50` → last n lines of `logs/activity.ndjson`, parsed.

**tail-harvests** `n=20` → last n lines of `logs/harvests.ndjson`, parsed.

**get-digest** `date` → parsed `daily/YYYY-MM-DD.json` if it exists.

**list-digests** → all dates with digests written.

**validate** → walk every file in the facility, check schema conformance, report deviations. Never auto-fix. Specifically:

- Every file in `events/YYYY-MM-DD/` matches an entry in `events/YYYY-MM-DD.jsonl`
- Every line in the daily JSONL matches a file
- Counters in `state.json` match the on-disk evidence
- No duplicate event ids
- All ids match `{surface}-{type}-{date}-{hash}`
- No stale lockfiles older than 1 hour
- Every event has the required envelope fields
- Every event references a `project` that exists in manifest, or is `"unsorted"`

### Write operations

**log-event** `event` (the highest-volume operation; uses optimistic per-event path)

```
1. Validate the event has all required envelope fields. Refuse if not.
2. Compute target path: events/YYYY-MM-DD/{id}.json from the event's timestamp.
3. If the target file already exists, return {status: "duplicate", id} silently. (Idempotent.)
4. Atomic write: write to {target}.tmp, fsync, rename to {target}.
5. Append the event to events/YYYY-MM-DD.jsonl (single-line JSON, < 4 KB; if larger, write only id + timestamp + surface + type + project to the index and keep heavy data in the JSON file).
6. Return {status: "written", id, path}.
```

Counters and `last_harvest_at` are NOT updated here — that's the batch-finalize step.

**finalize-batch** `{surface, count, max_timestamp, harvester, harvester_version}` (called by harvesters at end of run)

Under the `state.json` lock:

```
1. Bump counters.events_total by count.
2. Bump counters.events_by_surface[surface] by count.
3. (Counters by type and project are bumped lazily — see "lazy counter rebuild" below.)
4. If max_timestamp > last_harvest_at[surface]: update it.
5. If first_harvest_at is null: set to now.
6. Append to logs/activity.ndjson:
   {ts, actor: harvester, event: "events.batch.ingested", surface, count, max_timestamp}
7. Append to logs/harvests.ndjson:
   {ts, actor: harvester, surface, count, harvester_version, duration_ms, errors: []}
```

**log-digest** `{date, digest_json}` — write `daily/YYYY-MM-DD.json` and a placeholder `daily/YYYY-MM-DD.md` (the digest skill will overwrite the .md with prose). Update `state.json:last_digest_at` under the lock.

**log-weekly** `{week, report_json}` — same shape, in `weekly/`.

**log-longitudinal** `{kind, json}` — write `longitudinal/{kind}.json` (themes | velocity | projects | learning-loops | trajectory). Update `state.json:last_longitudinal_at`.

**log-skill-run** `{skill, args, outcome, duration_ms}` — append to `logs/skills.ndjson`. No lock needed (append-only).

**rebuild-index** `date` — read every JSON file in `events/YYYY-MM-DD/`, regenerate `events/YYYY-MM-DD.jsonl`. Use when the index is missing or corrupted.

**rebuild-state** — walk every event file across all dates, recompute counters from scratch, write `state.json`. Use when the file is corrupted or counters drift. Slow; not a daily operation.

**rebuild-cursors** — for each surface, find the max `timestamp` across its events, set `last_harvest_at[surface]` to that. Idempotent.

### Canonical write events (logged to activity.ndjson)

| Operation                       | Event name                  |
| ------------------------------- | --------------------------- |
| Facility initialized            | `facility.initialized`      |
| Single event written            | (not logged individually — too noisy) |
| Batch ingested by harvester     | `events.batch.ingested`     |
| Daily digest generated          | `digest.daily.generated`    |
| Weekly report generated         | `report.weekly.generated`   |
| Longitudinal rebuilt            | `longitudinal.{kind}.rebuilt` |
| Validation run                  | `state.validated`           |
| Index rebuilt                   | `index.rebuilt`             |
| State counters rebuilt          | `state.counters.rebuilt`    |
| Cursors rebuilt                 | `state.cursors.rebuilt`     |
| Manifest edited                 | `manifest.edited`           |

## Concurrency discipline (enforced from CONCURRENCY.md)

- **Per-event writes are lock-free** — deterministic ids + atomic file creation = idempotent, safe, parallel.
- **state.json and manifest.yaml writes use advisory lockfiles** — `locks/state.json.lock`, `locks/manifest.yaml.lock`, 5-minute TTL.
- **Append-only logs use O_APPEND** — single-line writes < 4 KB are atomic per POSIX.
- **Atomic renames for singletons** — `tmp + rename`, never overwrite in place.
- **Idempotency is mandatory** — every operation must be safe to retry.

## Lazy counter rebuild

`counters.events_by_type` and `counters.events_by_project` are computed lazily — they're not bumped on every write because batch finalize doesn't know the per-event breakdown without re-reading. Instead:

- `work-state count-events` always recomputes on demand (cheap if the date range is small).
- `work-state rebuild-state` recomputes everything (slow, occasional).
- `state.json:counters.events_total` and `counters.events_by_surface` ARE maintained on every batch finalize (they're the cheap roll-ups).

If a skill needs current per-type or per-project counts, it calls `count-events` rather than reading from `state.json`.

## What this skill does NOT do

- **Does not harvest.** That's `work-harvester-{surface}`.
- **Does not generate digests or reports.** That's `work-daily-digest`, `work-weekly-report`.
- **Does not infer themes.** That's `work-themes`.
- **Does not classify projects.** Accepts whatever `project` the caller passes; reattribution is `work-themes`/`work-metrics`'s job via correction events.
- **Does not send notifications.** Read-only writers; logging only.
- **Does not delete events.** Evidence is immutable. Period.

## Examples

### "What's the last GitHub harvest cursor?"

```
get-cursor github → return state.json:last_harvest_at["github"]
```

### "Log this build event"

Caller (a harvester) passes a fully-populated event. Validate envelope, write atomically, append to daily JSONL, return status.

### "Show me everything from yesterday"

```
list-events --since 2026-04-28T00:00:00 --until 2026-04-29T00:00:00
```

Walks `events/2026-04-28/`, returns the array.

### "How many events do I have this week broken down by project?"

```
count-events --since 2026-04-26 --until 2026-04-29 → {total, by_surface, by_type, by_project}
```

### "Validate the facility"

Walk all the invariants from CONCURRENCY.md → "Invariants the validator enforces". Return a report. Never auto-fix.

## Reference files

- `references/scaffold/manifest.yaml` — template manifest copied into place on `init`
- `references/scaffold/SCHEMA.md` — canonical schema, copied into the facility
- `references/scaffold/README.md` — facility README, copied into place
- `references/scaffold/CONCURRENCY.md` — concurrency doc, copied into place
- `references/scaffold/state.json` — initial empty state.json
- `references/event-validators.md` — per-surface evidence validators (sanity checks beyond envelope)
- `references/write-protocol.md` — pseudocode for the lock + write protocol

If the reference files are missing, the SKILL.md instructions above are self-sufficient.
