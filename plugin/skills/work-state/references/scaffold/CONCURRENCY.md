# CONCURRENCY — `~/work-state/`

The work-state system may be touched by multiple actors at once: scheduled harvests running on cron, manual harvests from the command line, webhook handlers responding to GitHub/Slack pushes, ad-hoc skill invocations from inside Claude. This document defines the rules that keep them from clobbering each other.

## Actors

- **Harvester skills** (`work-harvester-*`) — write events, update `state.json:last_harvest_at[surface]`.
- **Digest skills** (`work-daily-digest`, `work-weekly-report`, `work-longitudinal`) — write derived files (`daily/`, `weekly/`, `longitudinal/`); read events.
- **Foundation skill** (`work-state`) — the only skill allowed to mutate `state.json`, `manifest.yaml`, and the `logs/`. Every other skill routes through it.
- **Reader skills** (`work-themes`, `work-metrics`, `work-planner`, `work-dashboard`) — read-only over events + derived files.
- **Orchestrator** (`work-orchestrator`) — schedules other skills, never writes state directly.

## File classes & their concurrency rules

| Class                         | Examples                                         | Rule                                  |
| ----------------------------- | ------------------------------------------------ | ------------------------------------- |
| **Append-only logs**          | `logs/activity.ndjson`, `events/YYYY-MM-DD.jsonl` | Open with `O_APPEND`. POSIX guarantees atomic writes for entries up to `PIPE_BUF` (4096 bytes on macOS/Linux). Lines are bounded; no lock needed. |
| **Per-event JSON files**      | `events/YYYY-MM-DD/*.json`                        | Write-once. Filename is deterministic (id-based); the second writer with the same id is a no-op. No lock needed. |
| **Singleton mutable files**   | `state.json`, `manifest.yaml`                    | Advisory lockfile + atomic rename. See "Write protocol" below. |
| **Derived files**             | `daily/*.{md,json}`, `weekly/*.{md,json}`, `longitudinal/*.json` | Single writer per file; lock + atomic rename. Last-writer-wins is acceptable since these are regenerable. |
| **Harvest cursors**           | `state.json:last_harvest_at[surface]`            | Updated under the `state.json` lock at the END of a successful harvest, not before. |

## Write protocol

For any mutation to `state.json`, `manifest.yaml`, or a singleton derived file:

```
1. Check lock:   read locks/<target>.lock
                 if exists and (acquired + ttl_seconds) > now: WAIT (up to 30s) or ABORT
2. Acquire:      atomic-create locks/<target>.lock with {actor, acquired, ttl_seconds: 300}
                 (atomic-create = open with O_CREAT|O_EXCL, refuses if exists)
3. Read current:  load target file (or treat as empty)
4. Stale check:  if caller passed base_last_modified and current.last_modified > base: CONFLICT
5. Mutate:       apply changes in memory
6. Atomic write: write to <target>.tmp, fsync, rename to <target>
7. Append log:   logs/activity.ndjson += {ts, actor, event, ...}
8. Release:      delete locks/<target>.lock
```

If the actor crashes between step 2 and step 8, the lockfile is left behind. The TTL (5 minutes) makes it self-healing: any subsequent actor sees the lock as expired and proceeds. `work-state validate` reports stale locks but does not auto-clear them.

## Per-event writes — the optimistic path

The high-volume case (harvesting hundreds of events) does not need locks. Each event:

1. Compute deterministic id: `{surface}-{type}-{date}-{hash(canonical_payload)}`.
2. Compute path: `events/YYYY-MM-DD/{id}.json`.
3. If the path exists, this event was already ingested — skip silently. (Re-running a harvest is safe and idempotent.)
4. Otherwise, write atomically (`tmp` + rename).
5. Append the event to `events/YYYY-MM-DD.jsonl` (under `O_APPEND`, single line).

After the batch is done, the harvester takes the `state.json` lock once to:
- Bump counters
- Update `last_harvest_at[surface]`
- Append a single `events.batch.ingested` line to `logs/activity.ndjson`

This means a harvest of 500 events takes one lock, not 500.

## Idempotency

Every harvester operation must be idempotent. Re-running yesterday's harvest must produce zero new events (because the deterministic ids collide with already-written files). The cursor (`last_harvest_at[surface]`) is an optimization, not a correctness requirement — losing it forces a re-scan of old events but doesn't duplicate them.

## Append-only logs in detail

`logs/activity.ndjson` and `events/YYYY-MM-DD.jsonl` are append-only. Rules:

- Never rewrite. Never truncate. Corrections go in via new entries.
- Each line is bounded to **< 4 KB** to stay within `PIPE_BUF` for atomic appends. If a payload would exceed that, write the heavy data to a separate file and put a reference in the log.
- Writers open with `O_WRONLY | O_APPEND`, write a single line ending in `\n`, close.
- Readers can race writers freely (POSIX guarantees no torn lines for sub-`PIPE_BUF` writes).

## Conflict resolution

If a caller passes `base_last_modified` and discovers the file has moved on:

1. Caller receives `CONFLICT` with the current `last_modified`.
2. Caller is responsible for deciding: re-read, re-merge, retry. `work-state` does not auto-merge.
3. For derived files (`daily/`, `weekly/`, `longitudinal/`), conflicts are usually benign — last writer wins, and the file can be regenerated.
4. For `state.json`, conflicts on counter updates retry automatically (up to 3 times, 100ms backoff).

## Cursor semantics

`state.json:last_harvest_at[surface]` is the **maximum event timestamp** ingested for that surface, not the harvest run time. This means:

- A harvest started at `2026-04-29T06:00:00Z` that ingests events up to `2026-04-29T05:58:32Z` sets the cursor to `05:58:32Z`.
- The next harvest queries the surface for events with `timestamp > 05:58:32Z`.
- This is robust against backdated events showing up later (e.g., a Slack message edited yesterday): the harvester checks ids, not timestamps, for dedup.

## Webhook & manual modes

Webhook handlers (e.g., GitHub push webhook) write events using the same per-event optimistic path. They do not update `last_harvest_at[surface]` — that cursor is owned by the scheduled harvester. This way, the next scheduled run will redundantly fetch the events the webhook already wrote, find the deterministic ids already on disk, and skip them.

Manual on-demand harvests use the same cursor as scheduled ones. Running `work-harvester-github` interactively at noon picks up where the 6 AM scheduled run left off.

## What can go wrong, what we do about it

| Failure                                              | Outcome                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Harvester crashes mid-batch                          | Already-written events survive; cursor not advanced; re-run is safe and idempotent. |
| Two harvesters for the same surface run concurrently | Both write events; dedup by deterministic id; whichever advances the cursor last wins. No data loss. |
| Lockfile orphaned by a killed process                | TTL expires after 5 min; next actor proceeds. `work-state validate` reports the stale lock. |
| `state.json` corrupted (partial write)               | Atomic rename prevents this. If it happens anyway: `work-state rebuild-state` walks `events/` and reconstructs counters. |
| `events/YYYY-MM-DD.jsonl` corrupted                  | `work-state rebuild-index YYYY-MM-DD` regenerates from the per-event JSONs. |
| `manifest.yaml` edited by hand into invalid YAML     | Every skill that loads it fails fast. `work-state validate` reports. |

## Invariants the validator enforces

- Every file in `events/YYYY-MM-DD/` must appear as a line in `events/YYYY-MM-DD.jsonl`.
- Every line in `events/YYYY-MM-DD.jsonl` must correspond to a file in `events/YYYY-MM-DD/`.
- `state.json:counters.events_total` must equal the sum of files across all `events/*/` directories.
- No event file may be older than `manifest.yaml:identity.first_harvest_at` (sanity check).
- No two event files may share an `id`.
- All ids must match the pattern `{surface}-{type}-{date}-{hash}`.
- Lockfiles older than 1 hour are reported as suspicious.
