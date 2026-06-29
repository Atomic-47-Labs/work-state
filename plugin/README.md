# work-state plugin

Personal work intelligence facility for Claude Code. Harvests evidence of your work across GitHub, Gmail, Slack, Google Docs, and scsiwyg into a local, schema-governed data store — then derives daily digests, weekly reports, and longitudinal intelligence from it.

## What it includes

| Skill | Slash command | What it does |
|---|---|---|
| `work-state` | `/work-state` | Foundation — read, write, validate `~/work-state/`. The only skill that mutates the facility directly. |
| `work-orchestrator` | `/work-orchestrator` | Conductor — decides what to harvest, what digests are missing, runs the daily/weekly/longitudinal routines. |
| `work-harvester-github` | `/work-harvester-github` | Harvest GitHub commits, PRs, and releases via the `gh` CLI. |
| `work-harvester-gmail` | `/work-harvester-gmail` | Harvest sent + received Gmail messages via the Gmail MCP. |
| `work-harvester-slack` | `/work-harvester-slack` | Harvest Slack messages and DMs via the Slack MCP. |
| `work-harvester-scsiwyg` | `/work-harvester-scsiwyg` | Harvest scsiwyg blog publish and draft events via the scsiwyg MCP. |
| `work-harvester-gdocs` | `/work-harvester-gdocs` | Harvest Google Docs edits, creates, and shares via the Google Drive MCP. |
| `work-kanban` | `/work-kanban` | Start the local Next.js reporting UI at http://localhost:3333 (Kanban, Dashboard, Inventory views). App source is bundled in the plugin — auto-installs on first run. |

## Quick start

```
# 1. Initialize the facility (one-time — creates manifest.yaml, state.json, directories)
/work-state init

# 2. First harvest
/work-harvester-github --since 30d

# 3. Open the kanban dashboard (auto-installs the Next.js app on first run, then opens browser)
/work-kanban
```

> **Note:** `/work-kanban` requires `manifest.yaml` to exist (created by `init`) before the Kanban and Dashboard pages will load. Run `init` first.

## Architecture

```
Intelligence   longitudinal/*     ← themes, velocity, trajectory
Reports        daily/*, weekly/*  ← digests and summaries
Measurement    daily/*.json       ← numeric metrics
Evidence       events/YYYY-MM-DD/ ← immutable, append-only
```

All evidence lives at `~/work-state/`. Events are immutable JSON files with deterministic ids — re-running any harvester is always safe.

## Prerequisites

- `gh` CLI installed and authenticated (for GitHub harvesting)
- Gmail MCP, Slack MCP, Google Drive MCP, scsiwyg MCP configured in Claude Code (for the other surfaces)
- Node.js + npm (for the kanban UI at `~/work-state/kanban/`)

## Data stays local

Email bodies, Slack DMs, and commit messages stay on your machine in `~/work-state/`. Nothing leaves unless you build an explicit export skill.
