# `~/work-state/` — personal work intelligence facility

This directory is the source of truth for what David does across his portfolio. Every commit, post, send, share, and decision lands here as evidence. From that evidence, derived layers measure (daily/weekly metrics), report (digests), and reason (longitudinal intelligence — themes, velocity, learning loops, planning guidance).

## Mental model — four layers

```
┌─────────────────────────────────────────────────────────┐
│  Intelligence  ← work-themes, work-planner, work-dashboard
│                  longitudinal/*, weekly/*
├─────────────────────────────────────────────────────────┤
│  Reports       ← work-daily-digest, work-weekly-report
│                  daily/*, weekly/*
├─────────────────────────────────────────────────────────┤
│  Measurement   ← work-metrics
│                  daily/*.json, longitudinal/*.json
├─────────────────────────────────────────────────────────┤
│  Evidence      ← work-harvester-* (one per surface)
│                  events/YYYY-MM-DD/*.json + .jsonl
└─────────────────────────────────────────────────────────┘
```

Each layer reads from the layer below. The Evidence layer is **immutable**; everything above is **regenerable** from the evidence.

## Surfaces (where evidence comes from)

| Surface     | Harvester                    | Cadence  | Auth          |
| ----------- | ---------------------------- | -------- | ------------- |
| GitHub      | `work-harvester-github`      | daily    | `gh` CLI      |
| scsiwyg     | `work-harvester-scsiwyg`     | daily    | scsiwyg MCP   |
| Gmail       | `work-harvester-gmail`       | daily    | Gmail MCP     |
| Slack       | `work-harvester-slack`       | daily    | Slack MCP     |
| Google Docs | `work-harvester-gdocs`       | daily    | gDrive MCP    |
| X           | `work-harvester-x`           | daily    | manual export |
| LinkedIn    | `work-harvester-linkedin`    | daily    | manual export |

## Skills you can invoke

| Skill                    | What it does                                              |
| ------------------------ | --------------------------------------------------------- |
| `work-state`             | Foundation. Reads, writes, validates state. Every other skill routes through it. |
| `work-orchestrator`      | The conductor. Decides what to run next, given calendar + state. |
| `work-harvester-github`  | Pulls commits + PRs from GitHub. (Pattern for all harvesters.) |
| `work-daily-digest`      | (TBD) Synthesizes today's events into a narrative + metrics. |
| `work-weekly-report`     | (TBD) Innovation, projects, contribution, learning loops, week-on-week. |
| `work-themes`            | (TBD) Memetic analysis — what's recurring, what's emerging. |
| `work-metrics`           | (TBD) Velocity, output type distribution, project balance. |
| `work-longitudinal`      | (TBD) Trajectory, learning curves, plateau detection. |
| `work-planner`           | (TBD) Suggests where to focus next, based on longitudinal intel. |
| `work-dashboard`         | (TBD) HTML dashboard rendering current state. |

Skills marked TBD are part of the planned suite; built in later iterations once the foundation runs end-to-end.

## Invariants

1. **Evidence is immutable.** Once an event is written, it is never edited. Corrections go in as new events.
2. **All writes flow through `work-state`.** No skill mutates `~/work-state/` directly except `work-state` itself.
3. **Everything above evidence is regenerable.** If `daily/`, `weekly/`, `longitudinal/` are deleted, they can be rebuilt from `events/`.
4. **Idempotent harvests.** Re-running a harvest produces zero new events.
5. **Local first.** Nothing leaves this directory unless an export skill explicitly does so. `raw` payloads in event files may contain sensitive material (email bodies, Slack DMs).

## File index

- `manifest.yaml` — identity, surfaces config, projects, themes, cadence
- `state.json` — live counters, last-harvest cursors, lock state
- `SCHEMA.md` — canonical schema for all files
- `CONCURRENCY.md` — write protocol, locking, conflict resolution
- `README.md` — this file

## How harvesting actually runs

**Hybrid mode:**

1. **Scheduled** — a cron/launchd job runs `work-orchestrator daily-harvest` each morning. It invokes each enabled harvester in turn.
2. **Manual** — you can run any harvester on-demand at any time. Idempotent; safe.
3. **Webhook** — for GitHub and Slack (where webhooks are free), an inbound webhook can call `work-harvester-* --webhook` with a single event payload. The event is written immediately; the cursor is not advanced (the next scheduled run handles that).

## Bootstrapping

The first time you run anything against `~/work-state/`:

```bash
# 1. Scaffold (one-time)
work-state init                # creates the directory tree, writes initial state.json

# 2. First harvest
work-harvester-github --since 30d   # pulls last 30 days of evidence

# 3. First digest
work-daily-digest 2026-04-29
```

After the first harvest, `last_harvest_at[github]` is set, and subsequent runs are incremental.

## What this system is and is not

**It is:**
- A personal evidence-and-intelligence facility for one human's work.
- AI-readable by design — every event, digest, and report is structured and queryable.
- Local-first — your evidence stays on your machine.
- Composable — every layer is replaceable; the schema is the contract.

**It is not:**
- A team productivity dashboard (different problem, different schema).
- A replacement for `.project-state/` (project-state is per-project; work-state is per-person, cross-project).
- Real-time. The minimum latency from event-happens to event-in-state is 24 hours under daily cadence; webhooks bring it down to seconds for supported surfaces.
- A timesheet or billing system. It measures output, not hours.
