---
name: work-orchestrator
description: "The conductor of the work-* skill suite. Decides what to do next based on `~/work-state/` — pending harvests, missing digests, weekly reports due, longitudinal refreshes, validation issues. Use whenever the user says 'morning briefing for my work', 'run the daily routine', 'work-state status', 'what should I do today across all my projects', 'harvest everything', 'run the orchestrator', 'sync my work state', 'catch me up on the week', 'what's the work-state telling me', or any request asking the work-state facility to tell itself what to do next. Invokes other work-* skills as needed and hands decisions back to the user. Thin by design — this skill routes, it does not do the lifecycle work itself."
---

# work-orchestrator — the conductor

## Purpose

`work-orchestrator` looks at the current state of `~/work-state/` and the calendar, and decides what should run next. It is the single entry point for "do the right thing" — whether that's a daily harvest, a digest, a weekly report, or a validation pass.

It is thin by design. It calls other work-* skills (via `work-state` for reads, then directly for the worker skills). It does not harvest, digest, or report on its own.

## When to invoke

Trigger on any of:
- "Morning briefing for my work"
- "What should the work-state do today"
- "Run the daily routine"
- "Sync work state"
- "Catch me up on this week"
- "Work-state status"
- Cron job: `0 6 * * *` invokes `work-orchestrator daily-routine`
- Cron job: `0 8 * * 1` invokes `work-orchestrator weekly-routine`
- Cron job: `0 22 * * 0` invokes `work-orchestrator longitudinal-routine`

## What it actually does

### Step 1 — Read state

Via `work-state`:
- `get-manifest` → enabled surfaces, cadences
- `get-state` → last_harvest_at[*], last_digest_at, last_weekly_at, last_longitudinal_at
- `validate` → quick health check (skip the slow walks; just check stale locks + counter drift)

### Step 2 — Decide what's due

Build a checklist:

| Check                                                                | Action if needed                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Stale locks older than 1 hour                                        | Report to user. Do NOT auto-clear. Ask permission.                              |
| `manifest.yaml` invalid                                              | Stop. Report. Ask user to fix.                                                  |
| Any enabled surface where `last_harvest_at[surface]` is > 26 hours old (or null) | Schedule harvest for that surface (call `work-harvester-{surface}`).            |
| Yesterday's digest missing (no `daily/YYYY-MM-DD.json` for yesterday) | Call `work-daily-digest` for yesterday.                                         |
| Today is Monday and last_weekly_at is older than 6 days              | Call `work-weekly-report` for last week.                                        |
| Today is Sunday and last_longitudinal_at is older than 6 days        | Call `work-longitudinal` to rebuild themes/velocity/projects/learning-loops.    |
| `count-events` from `state.json:counters` differs from on-disk count | Suggest `work-state rebuild-state`. Ask permission first — slow op.             |
| Any harvester reported errors in `logs/harvests.ndjson` last run     | Report to user; surface the errors.                                             |

### Step 3 — Plan & confirm

For an interactive run, present the checklist with what would happen and ask:

> Here's what's pending:
> - GitHub: last harvest 28 hours ago — will harvest now.
> - scsiwyg: last harvest 2 hours ago — skipping.
> - Yesterday's digest missing — will generate after harvests complete.
> - Weekly report not due until Monday.
>
> Proceed?

For a scheduled run (`--unattended`), skip the confirmation and execute. Log every action to `logs/skills.ndjson` via `work-state log-skill-run`.

### Step 4 — Execute in dependency order

```
1. Validations & lock checks (fail fast)
2. Harvests (parallel where possible — they don't share locks; they each finalize their own batch)
3. Daily digest (depends on harvests being done)
4. Weekly report (depends on daily digests for the week being present)
5. Longitudinal refresh (depends on a full week of digests + events)
```

### Step 5 — Report

Produce a short summary:

> Work-state synced.
> - GitHub: 14 events ingested (12 builds, 2 drafts) — 3 repos active.
> - scsiwyg: 1 event (1 publish) — making-scsiwyg.
> - Gmail: 87 events (52 receive, 35 share) — 14 unique correspondents.
> - Slack: 23 events (18 share, 5 receive) — 4 channels.
> - Yesterday's digest written: 7 highlights, top themes [headless-platform, sovereignty].
>
> Next actions:
> - Weekly report due Monday morning.
> - Longitudinal refresh due Sunday evening.

If anything failed, report it clearly with the error and the surface that broke. Do not try to recover — leave the state for a human to inspect.

## Routines

### `daily-routine`

The default. Steps 1–5 above. Designed to run unattended at `cadence:daily_harvest` time.

### `weekly-routine`

Same as daily-routine but adds an explicit weekly-report check, even if a daily run already triggered it. Designed for `cadence:weekly_report` time (Monday 08:00).

### `longitudinal-routine`

Just the longitudinal refresh + a state validation pass. Sundays at 22:00.

### `status`

Read-only. Reports the state of the facility without doing anything:

> Work-state status (as of 2026-04-29 14:23):
>
> Facility: ~/work-state (initialized 2026-04-15)
> Total events: 1,247
> By surface: github=312, scsiwyg=18, gmail=487, slack=388, gdocs=42
> By type: build=312, publish=20, share=534, draft=88, receive=293
> Last harvests:
>   github: 8h ago ✓
>   scsiwyg: 8h ago ✓
>   gmail: 8h ago ✓
>   slack: 8h ago ✓
>   gdocs: 8h ago ✓
>   x: never (manual export pending)
>   linkedin: never (manual export pending)
> Last digest: yesterday ✓
> Last weekly: 3 days ago ✓
> Last longitudinal: 2 days ago ✓
> No stale locks. No validation issues.

### `catch-up`

For a returning user who has been away. Argument: `--since 7d` (or any duration). Runs all needed harvests, digests, weeklies, longitudinal in dependency order to bring the facility current.

## What this skill does NOT do

- **Does not write events.** Harvesters do that.
- **Does not generate report content.** Daily-digest and weekly-report do that.
- **Does not infer themes.** work-themes does that.
- **Does not auto-recover from errors.** It surfaces them; humans decide.
- **Does not retry failed harvests.** A human reruns the orchestrator after fixing whatever broke.

## Examples

### "Morning briefing"

```
work-orchestrator daily-routine
```

→ runs harvests in parallel, generates yesterday's digest, reports outcomes.

### "What's the work-state status?"

```
work-orchestrator status
```

→ read-only summary, no side effects.

### "I've been on vacation for two weeks, catch me up."

```
work-orchestrator catch-up --since 14d
```

→ pulls 14 days of events from each surface, generates 14 daily digests, 2 weekly reports, refreshes longitudinal once at the end. Reports total work synthesized.

### "Weekly report"

```
work-orchestrator weekly-routine
```

→ checks if last week's report exists; if not, generates it. If today's harvests aren't done, runs them first.

## Reference files

- `references/checklist.yaml` — the checklist Step 2 walks, in machine-readable form
- `references/dependency-graph.md` — which work-* skills depend on which (for execution ordering)

If the reference files are missing, the SKILL.md instructions above are self-sufficient.
