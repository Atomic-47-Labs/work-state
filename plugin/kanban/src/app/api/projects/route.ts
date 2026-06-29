import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { listEventDates, readDayEvents } from '@/lib/events'

const WORK_STATE = path.join(process.env.HOME!, 'work-state')

interface ManifestProjectSurfaces {
  github?: { repos?: string[]; local_paths?: string[] }
  slack?:  { channels?: string[] }
  gmail?:  { threads_matching?: string[] }
}

interface ManifestProject {
  id: string
  name?: string
  aliases?: string[]
  portfolio: string
  status: string
  priority: number
  parent?: string
  surfaces?: ManifestProjectSurfaces
}

interface Manifest {
  projects: ManifestProject[]
  surfaces: Record<string, { enabled: boolean }>
  identity: { owner: string; timezone: string; github_accounts?: { primary: string; secondary?: string } }
}

interface WorkEvent {
  id: string
  surface: string
  type: string
  timestamp: string
  project: string
  themes: string[]
  evidence: Record<string, string>
  metrics: Record<string, number>
}

interface StateJson {
  counters: {
    events_total: number
    events_by_project: Record<string, number>
    events_by_surface: Record<string, number>
    events_by_type: Record<string, number>
  }
  last_harvest_at: Record<string, string | null>
}

function getExcerpt(event: WorkEvent): string {
  return (
    event.evidence.message ||
    event.evidence.text_excerpt ||
    event.evidence.subject ||
    event.type
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') || '30')

  try {
    const manifestRaw = fs.readFileSync(path.join(WORK_STATE, 'manifest.yaml'), 'utf-8')
    const manifest = yaml.load(manifestRaw) as Manifest

    const stateRaw = fs.readFileSync(path.join(WORK_STATE, 'state.json'), 'utf-8')
    const state = JSON.parse(stateRaw) as StateJson

    const now = new Date()
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - days)

    // Build repo → project lookup from manifest v2 surfaces.github.repos
    // This lets us re-attribute events stored as "unsorted" when the manifest
    // now has an explicit binding for the repo.
    const repoToProject: Record<string, string> = {}
    for (const p of manifest.projects) {
      const repos = p.surfaces?.github?.repos || []
      for (const repo of repos) {
        // Normalise: strip leading account prefix for matching against event.evidence.repo
        // Stored form is typically "owner/repo", but match both "owner/repo" and "repo"
        repoToProject[repo.toLowerCase()] = p.id
        const shortName = repo.split('/').pop()
        if (shortName) repoToProject[shortName.toLowerCase()] = p.id
      }
    }

    // Per-project event buckets
    const eventsByProject: Record<string, WorkEvent[]> = {}
    // Per-project repo commit counts
    const reposByProject: Record<string, Record<string, number>> = {}
    // Track last commit per repo (for untracked display)
    const repoLastCommit: Record<string, string> = {}

    const eventsDir = path.join(WORK_STATE, 'events')

    for (const dateDir of listEventDates(eventsDir)) {
        if (new Date(dateDir + 'T00:00:00Z') < cutoff) continue
        for (const event of readDayEvents<WorkEvent>(eventsDir, dateDir)) {
          try {
            // Re-attribute: manifest v2 explicit repo bindings always win —
            // this fixes both "unsorted" events and events misattributed at
            // harvest time (e.g. ai26-10-project-plan stored as project-sunshine).
            let proj = event.project || 'unsorted'
            if (event.surface === 'github' && event.evidence?.repo) {
              const repo = String(event.evidence.repo)
              const mapped =
                repoToProject[repo.toLowerCase()] ||
                repoToProject[repo.split('/').pop()?.toLowerCase() || '']
              if (mapped) proj = mapped
            }

            if (!eventsByProject[proj]) eventsByProject[proj] = []
            eventsByProject[proj].push({ ...event, project: proj })

            // Track GitHub repos per project
            if (event.surface === 'github' && event.evidence?.repo) {
              const repo = event.evidence.repo
              if (!reposByProject[proj]) reposByProject[proj] = {}
              reposByProject[proj][repo] = (reposByProject[proj][repo] || 0) + 1
              if (!repoLastCommit[repo] || event.timestamp > repoLastCommit[repo]) {
                repoLastCommit[repo] = event.timestamp
              }
            }
          } catch {}
        }
    }

    // 14-day sparkline keys
    const sparklineKeys: string[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      sparklineKeys.push(d.toISOString().split('T')[0])
    }

    // Set of all repo names that ARE attributed to a named project
    const attributedRepos = new Set<string>()

    const projects = manifest.projects.map(p => {
      const events = eventsByProject[p.id] || []
      const sorted = [...events].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      const bySurface: Record<string, number> = {}
      const byType: Record<string, number> = {}
      const themeSet = new Set<string>()

      for (const e of events) {
        bySurface[e.surface] = (bySurface[e.surface] || 0) + 1
        byType[e.type]       = (byType[e.type]       || 0) + 1
        e.themes?.forEach(t => themeSet.add(t))
      }

      const sparkline = sparklineKeys.map(date => ({
        date,
        count: events.filter(e => e.timestamp?.startsWith(date)).length,
      }))

      // Repos for this project
      const repos = Object.entries(reposByProject[p.id] || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, commits]) => ({
          name,
          commits,
          last_commit: repoLastCommit[name] || null,
        }))

      repos.forEach(r => attributedRepos.add(r.name))

      // A project is code-only if it has github builds but zero comms surfaces
      const commsCount =
        (bySurface['gmail'] || 0) +
        (bySurface['slack'] || 0) +
        (bySurface['gdocs'] || 0)
      const is_code_only = (bySurface['github'] || 0) > 0 && commsCount === 0

      return {
        id: p.id,
        name: p.name || p.id,
        aliases: p.aliases || [],
        portfolio: p.portfolio,
        status: p.status,
        priority: p.priority,
        parent: p.parent || null,   // e.g. haiku-tab → nutabu
        bound_repos: p.surfaces?.github?.repos || [],
        bound_channels: p.surfaces?.slack?.channels || [],
        events_total: state.counters.events_by_project?.[p.id] || 0,
        events_recent: events.length,
        events_by_surface: bySurface,
        events_by_type: byType,
        themes: Array.from(themeSet).slice(0, 5),
        last_activity: sorted[0]?.timestamp || null,
        last_event: sorted[0]
          ? {
              type: sorted[0].type,
              surface: sorted[0].surface,
              excerpt: getExcerpt(sorted[0]).slice(0, 120),
            }
          : null,
        sparkline,
        repos,
        is_code_only,
      }
    })

    // Untracked repos: github repos in the period with no project attribution
    // (repos that appear under "unsorted" or any project not in manifest)
    const knownProjectIds = new Set(manifest.projects.map(p => p.id))
    const untrackedRepoMap: Record<string, { commits: number; last_commit: string }> = {}

    for (const [projId, repos] of Object.entries(reposByProject)) {
      if (knownProjectIds.has(projId)) continue  // already attributed
      for (const [repo, commits] of Object.entries(repos)) {
        if (!untrackedRepoMap[repo]) {
          untrackedRepoMap[repo] = { commits: 0, last_commit: repoLastCommit[repo] || '' }
        }
        untrackedRepoMap[repo].commits += commits
      }
    }

    const untracked_repos = Object.entries(untrackedRepoMap)
      .sort((a, b) => b[1].commits - a[1].commits)
      .map(([name, { commits, last_commit }]) => ({ name, commits, last_commit }))

    // Portfolio order — left to right across the kanban
    const portfolioOrder = ['worksona', 'atomic47', 'nutabu', 'aimqc', 'market-research', 'personal']
    const portfolios = portfolioOrder.filter(p =>
      manifest.projects.some(proj => proj.portfolio === p)
    )

    return NextResponse.json({
      projects,
      portfolios,
      unsorted_recent: (eventsByProject['unsorted'] || []).length,
      untracked_repos,
      state: {
        events_total: state.counters.events_total,
        events_by_surface: state.counters.events_by_surface,
        last_harvest_at: state.last_harvest_at,
      },
      days,
    })
  } catch (err) {
    console.error('[/api/projects]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
