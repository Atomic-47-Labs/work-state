---
name: work-kanban
description: "Start and open the work-state reporting UI — a local Next.js app at ~/work-state/kanban/ that runs on port 3333. Serves three views: Kanban (projects as cards, grouped by portfolio/status/activity/timeline), Dashboard (macro time-series, surface trends, project heatmap), and Inventory (all projects and repos, searchable/sortable/filterable). Trigger on '/work-kanban', 'open the kanban', 'start the kanban', 'open work-state UI', 'launch the reporting UI', 'show me the kanban', or any request to open, start, or check the work-state web interface."
---

# work-kanban — the reporting UI launcher

## Purpose

`work-kanban` starts the work-state local reporting application and opens it in the browser. The app reads `~/work-state/` directly — no separate database, no sync step. Every page load is a fresh read from the flat-file corpus.

The app runs on **http://localhost:3333** and has three pages:

| Page       | URL                       | Question answered                                             |
| ---------- | ------------------------- | ------------------------------------------------------------- |
| Kanban     | /                         | Which projects are alive right now, and what's moving?        |
| Dashboard  | /dashboard                | What does the macro shape of my work look like over time?     |
| Inventory  | /inventory                | What do I have? All projects and repos, searchable.           |
| Project    | /project/[id]             | Micro-dashboard: granular stats, timeline, repos for one project. |

## Location

```
~/work-state/kanban/          ← Next.js 15 app
├── src/app/                  ← pages (page.tsx, dashboard, inventory, project/[id])
├── src/app/api/              ← server routes (projects, events, timeline)
├── src/components/           ← work-kanban-app, inventory-app, project-detail-app, nav
└── package.json              ← "dev": "next dev -p 3333"
```

## Subcommands

| Subcommand | What it does                                         |
| ---------- | ---------------------------------------------------- |
| (none)     | Default: start server if needed, open browser        |
| `start`    | Start dev server only (don't open browser)           |
| `stop`     | Kill the process on port 3333                        |
| `status`   | Report whether the server is running + work-state summary |
| `restart`  | Stop then start                                      |
| `open`     | Open browser (assumes server already running)        |

## Execution steps

### Step 1 — Check if server is already running

```bash
lsof -ti tcp:3333 | head -1
```

- If a PID is returned → server is already up. Skip to Step 3.
- If empty → proceed to Step 2.

### Step 2 — Start the dev server

```bash
cd ~/work-state/kanban && npm run dev > /tmp/work-kanban.log 2>&1 &
```

Wait up to 10 seconds for port 3333 to become available:

```bash
for i in $(seq 1 10); do
  lsof -ti tcp:3333 > /dev/null 2>&1 && break
  sleep 1
done
```

If port never opens, report the error and show the last lines of `/tmp/work-kanban.log`.

### Step 3 — Open browser (unless `start` subcommand)

```bash
open http://localhost:3333
```

On Linux use `xdg-open`. If neither is available, print the URL.

### Step 4 — Show work-state summary

Read `~/work-state/state.json` and `~/work-state/manifest.yaml` and print a brief status:

```
✓ work-state kanban running at http://localhost:3333

Work-state summary:
  Total events:   931
  Projects:       16 (6 active in last 30 days)
  Last harvests:
    github   22h ago
    gmail    1d ago
    slack    1d ago
    gdocs    1d ago
```

Pull `events_total` from `state.json:counters.events_total`, `last_harvest_at` from `state.json:last_harvest_at`, and project count from `manifest.yaml:projects`.

"Active in last 30 days" = projects where `events_by_project[id] > 0` in state.json counters (approximation — exact count requires walking events/).

## Stop subcommand

```bash
PID=$(lsof -ti tcp:3333)
if [ -n "$PID" ]; then
  kill $PID
  echo "Stopped work-kanban (PID $PID)"
else
  echo "work-kanban is not running"
fi
```

## Status subcommand

Check port 3333 and print the work-state summary regardless. Report:
- Running / Not running
- Uptime if PID found and `/proc` is available; otherwise omit
- work-state summary (events, projects, harvests)

## Restart subcommand

Run Stop then Start in sequence.

## Error handling

| Error                              | Action                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| `~/work-state/kanban/` not found   | Tell the user the kanban hasn't been initialised yet and suggest `cd ~/work-state && git clone ...` or check the path. |
| `node_modules` missing             | Run `npm install` inside `~/work-state/kanban/` before starting. |
| Port 3333 already in use by something else | Report which process owns it (`lsof -i tcp:3333`) and ask before killing. |
| Server starts but never responds   | Show last 20 lines of `/tmp/work-kanban.log`.                  |
| `state.json` missing               | Skip work-state summary; report that work-state hasn't been seeded. |

## Notes

- The app auto-refreshes every 60 seconds from the corpus. No restart needed after a harvest.
- Range selector (7d / 30d / 90d / All time) is in the sidebar on Kanban and the toolbar on Inventory/Dashboard — change it in-browser after opening.
- Project detail pages live at `/project/{project-id}` — navigate there from the Kanban nib panel ("Full detail ↗") or from any project name in Inventory.
- The Untracked Repos column on the Kanban shows GitHub repos with no project attribution — fix by updating `~/work-state/manifest.yaml` with new project aliases.
