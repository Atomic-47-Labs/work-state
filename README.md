# work-state

A Claude Code **marketplace** for the `work-state` plugin — a local-first, schema-governed work-intelligence facility.

`work-state` harvests evidence of your work across GitHub, Gmail, Slack, Google Docs, scsiwyg, and Claude Code sessions into an immutable, event-sourced data store, then derives daily digests, weekly reports, and longitudinal intelligence. It ships with a local Next.js kanban/dashboard UI at `localhost:3333`.

## Install

```
/plugin marketplace add Atomic-47-Labs/work-state
/plugin install work-state@work-state
```

## What's in the plugin

9 skills:

| Skill | Purpose |
|---|---|
| `work-state` | Read/write/validate the `~/work-state/` store — the only skill that mutates it |
| `work-orchestrator` | Conductor — decides what to run, dispatches harvesters |
| `work-harvester-github` | Harvest commits, PRs, releases |
| `work-harvester-gmail` | Harvest sent + filtered inbound mail |
| `work-harvester-slack` | Harvest messages, DMs, mentions |
| `work-harvester-gdocs` | Harvest Google Docs edits and shares |
| `work-harvester-scsiwyg` | Harvest blog publish/draft events |
| `work-harvester-claude-code` | Harvest Claude Code session activity |
| `work-kanban` | Start the local reporting UI at `localhost:3333` |

## Architecture

Four layers, each reading only from the one below; the **Evidence** layer (immutable per-event JSON) is the source of truth and everything above it is regenerable:

```
Intelligence   longitudinal/, weekly/        themes, velocity, trajectory
Reports        daily/*.{md,json}, weekly/     digests and summaries
Measurement    daily/*.json, longitudinal/    numeric metrics
Evidence       events/YYYY-MM-DD/*.json        immutable, append-only
```

## License

MIT © Atomic 47 Labs
