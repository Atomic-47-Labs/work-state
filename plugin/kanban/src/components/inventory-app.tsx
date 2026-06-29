'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SparkPoint { date: string; count: number }

interface Project {
  id: string
  aliases: string[]
  portfolio: string
  status: string
  priority: number
  events_total: number
  events_recent: number
  events_by_surface: Record<string, number>
  events_by_type: Record<string, number>
  themes: string[]
  last_activity: string | null
  last_event: { type: string; surface: string; excerpt: string } | null
  sparkline: SparkPoint[]
  repos: Array<{ name: string; commits: number; last_commit: string | null }>
  is_code_only: boolean
}

interface UntrackedRepo {
  name: string
  commits: number
  last_commit: string
}

interface ApiResponse {
  projects: Project[]
  portfolios: string[]
  unsorted_recent: number
  untracked_repos: UntrackedRepo[]
  state: {
    events_total: number
    events_by_surface: Record<string, number>
    last_harvest_at: Record<string, string | null>
  }
  days: number
}

type ViewMode    = 'card' | 'list'
type Tab         = 'projects' | 'repos'
type ProjectSort = 'priority' | 'recent' | 'alltime' | 'name' | 'portfolio'
type RepoSort    = 'commits' | 'last_commit' | 'name'
type FocusFilter = 'all' | 'code-only' | 'has-comms'

// ─── Style constants ──────────────────────────────────────────────────────────

const SURFACE_STYLE: Record<string, { label: string; pill: string; dot: string; hex: string }> = {
  github:  { label: 'GitHub',  pill: 'bg-stone-100 text-stone-600 border border-stone-300',   dot: 'bg-stone-500',   hex: '#78716c' },
  slack:   { label: 'Slack',   pill: 'bg-purple-50 text-purple-700 border border-purple-200', dot: 'bg-purple-500',  hex: '#a855f7' },
  gmail:   { label: 'Gmail',   pill: 'bg-red-50 text-red-700 border border-red-200',          dot: 'bg-red-500',     hex: '#ef4444' },
  gdocs:   { label: 'GDocs',   pill: 'bg-blue-50 text-blue-700 border border-blue-200',       dot: 'bg-blue-500',    hex: '#3b82f6' },
  scsiwyg:  { label: 'Scsiwyg',  pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200',  dot: 'bg-emerald-500',  hex: '#10b981' },
  linkedin: { label: 'LinkedIn', pill: 'bg-blue-50 text-blue-700 border border-blue-300',           dot: 'bg-blue-600',     hex: '#0a66c2' },
  x:        { label: 'X',        pill: 'bg-stone-900 text-stone-100 border border-stone-700',        dot: 'bg-stone-800',    hex: '#000000' },
  substack:     { label: 'Substack',     pill: 'bg-orange-50 text-orange-700 border border-orange-300',       dot: 'bg-orange-500',    hex: '#ff6719' },
  'claude-code': { label: 'Claude Code', pill: 'bg-violet-50 text-violet-700 border border-violet-200',       dot: 'bg-violet-500',    hex: '#8b5cf6' },
}

const STATUS_STYLE: Record<string, string> = {
  'active':                    'bg-emerald-50 text-emerald-700 border border-emerald-300',
  'designed':                  'bg-sky-50 text-sky-700 border border-sky-200',
  'production-bible-complete': 'bg-amber-50 text-amber-700 border border-amber-300',
}

const PORTFOLIO_META: Record<string, { label: string; dot: string; border: string; bg: string; text: string }> = {
  worksona:          { label: 'Worksona',        dot: 'bg-amber-500',   border: 'border-amber-300',   bg: 'bg-amber-50',   text: 'text-amber-800' },
  atomic47:          { label: 'Atomic47',        dot: 'bg-orange-500',  border: 'border-orange-300',  bg: 'bg-orange-50',  text: 'text-orange-800' },
  nutabu:            { label: 'Nutabu',          dot: 'bg-rose-500',    border: 'border-rose-300',    bg: 'bg-rose-50',    text: 'text-rose-800' },
  aimqc:             { label: 'AIMQC',           dot: 'bg-sky-500',     border: 'border-sky-300',     bg: 'bg-sky-50',     text: 'text-sky-800' },
  'market-research': { label: 'Market Research', dot: 'bg-violet-500',  border: 'border-violet-300',  bg: 'bg-violet-50',  text: 'text-violet-800' },
  personal:          { label: 'Personal',        dot: 'bg-teal-500',    border: 'border-teal-300',    bg: 'bg-teal-50',    text: 'text-teal-700' },
}

const ALL_SURFACES = ['github', 'slack', 'gmail', 'gdocs', 'scsiwyg', 'claude-code', 'linkedin', 'x', 'substack']

const DAY_OPTIONS = [
  { label: '7d',  value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 365 },
]

const PROJECT_SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: 'priority',  label: 'Priority' },
  { value: 'recent',    label: 'Recent activity' },
  { value: 'alltime',   label: 'All-time events' },
  { value: 'name',      label: 'Name A–Z' },
  { value: 'portfolio', label: 'Portfolio' },
]

const REPO_SORT_OPTIONS: { value: RepoSort; label: string }[] = [
  { value: 'commits',     label: 'Most commits' },
  { value: 'last_commit', label: 'Most recent' },
  { value: 'name',        label: 'Name A–Z' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-stone-900 text-stone-100 text-xs px-2.5 py-1.5 shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {label}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-stone-900" />
      </span>
    </span>
  )
}

// ─── Micro ────────────────────────────────────────────────────────────────────

function PortfolioBadge({ portfolio }: { portfolio: string }) {
  const m = PORTFOLIO_META[portfolio]
  if (!m) return <span className="text-xs text-stone-400">{portfolio}</span>
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs px-2 py-px border font-medium', m.border, m.bg, m.text)}>
      <span className={clsx('w-1.5 h-1.5', m.dot)} />
      {m.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] ?? 'bg-stone-100 text-stone-600 border border-stone-200'
  return (
    <span className={clsx('inline-flex text-xs px-2 py-px font-medium border', cls)}>
      {status.replace(/-/g, ' ')}
    </span>
  )
}

function SurfaceBar({ bySurface }: { bySurface: Record<string, number> }) {
  const total = Object.values(bySurface).reduce((s, c) => s + c, 0)
  if (total === 0) return <div className="h-1.5 bg-stone-100 w-full" />
  return (
    <div className="flex h-1.5 gap-px overflow-hidden w-full">
      {ALL_SURFACES.map(s => {
        const c = bySurface[s] || 0
        if (c === 0) return null
        const meta = SURFACE_STYLE[s]
        return (
          <Tooltip key={s} label={`${meta?.label ?? s}: ${c}`}>
            <div style={{ flex: c }} className={clsx('h-full cursor-default', meta?.dot ?? 'bg-stone-400')} />
          </Tooltip>
        )
      })}
    </div>
  )
}

function Sparkline({ data }: { data: SparkPoint[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-px h-6">
      {data.map(({ date, count }) => (
        <Tooltip key={date} label={`${date}: ${count}`}>
          <div
            style={{ height: count > 0 ? `${Math.max((count / max) * 100, 14)}%` : '10%' }}
            className={clsx('flex-1 transition-all cursor-default', count > 0 ? 'bg-amber-400/70 hover:bg-amber-500' : 'bg-stone-200')}
          />
        </Tooltip>
      ))}
    </div>
  )
}

// ─── Project card view ────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const pm = PORTFOLIO_META[project.portfolio]
  const totalSurface = Object.values(project.events_by_surface).reduce((s, c) => s + c, 0)

  return (
    <div className="bg-white border border-stone-200 shadow-sm hover:shadow-md hover:border-stone-300 transition-all flex flex-col">
      {/* Portfolio colour strip */}
      <div className={clsx('h-0.5 w-full', pm?.dot ?? 'bg-stone-300')} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={`/project/${project.id}`} className="text-sm font-bold text-stone-800 hover:text-amber-700 leading-tight transition-colors">
                {project.id}
              </Link>
              <Tooltip label={`Priority ${project.priority}`}>
                <span className="text-xs bg-stone-100 text-stone-500 border border-stone-200 px-1.5 py-px font-mono cursor-default">
                  P{project.priority}
                </span>
              </Tooltip>
              {project.is_code_only && (
                <Tooltip label="GitHub activity only — no email, Slack, or Docs">
                  <span className="text-xs bg-amber-50 text-amber-700 border border-amber-300 px-1.5 py-px font-medium cursor-default">
                    code only
                  </span>
                </Tooltip>
              )}
            </div>
            {project.aliases?.filter(a => a !== project.id).length > 0 && (
              <p className="text-xs text-stone-400 mt-0.5 truncate">
                {project.aliases.filter(a => a !== project.id).join(', ')}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <Tooltip label={`${project.events_recent} events in selected period`}>
              <div className="text-xl font-bold text-stone-700 tabular-nums leading-none cursor-default">
                {project.events_recent}
              </div>
            </Tooltip>
            <div className="text-xs text-stone-400">recent</div>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1">
          <PortfolioBadge portfolio={project.portfolio} />
          <StatusBadge status={project.status} />
        </div>

        {/* Sparkline */}
        <Sparkline data={project.sparkline} />

        {/* Surface bar */}
        {totalSurface > 0 && <SurfaceBar bySurface={project.events_by_surface} />}

        {/* Description: themes */}
        {project.themes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {project.themes.slice(0, 4).map(t => (
              <span key={t} className="text-xs bg-stone-50 text-stone-500 border border-stone-200 px-1.5 py-px truncate max-w-[120px]">
                #{t}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-300 italic">No themes recorded</p>
        )}

        {/* Repos */}
        {project.repos.length > 0 && (
          <div className="border-t border-stone-100 pt-2 space-y-1">
            {project.repos.slice(0, 3).map(r => (
              <Tooltip key={r.name} label={`${r.commits} commit${r.commits !== 1 ? 's' : ''}${r.last_commit ? ' · ' + timeAgo(r.last_commit) : ''}`}>
                <div className="flex items-center justify-between gap-2 cursor-default">
                  <span className="text-xs font-mono text-stone-500 truncate">{r.name}</span>
                  <span className="text-xs text-stone-400 tabular-nums shrink-0">{r.commits}c</span>
                </div>
              </Tooltip>
            ))}
            {project.repos.length > 3 && (
              <p className="text-xs text-stone-300">+{project.repos.length - 3} more</p>
            )}
          </div>
        )}

        {/* Footer: last activity */}
        <div className="mt-auto border-t border-stone-100 pt-2 flex items-center justify-between gap-2">
          {project.last_activity ? (
            <span className="text-xs text-stone-400">{timeAgo(project.last_activity)}</span>
          ) : (
            <span className="text-xs text-stone-300">No activity</span>
          )}
          <Tooltip label={`${project.events_total.toLocaleString()} all-time events`}>
            <span className="text-xs text-stone-400 tabular-nums cursor-default">
              {project.events_total.toLocaleString()} total
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// ─── Project list row ─────────────────────────────────────────────────────────

function ProjectRow({ project }: { project: Project }) {
  const pm = PORTFOLIO_META[project.portfolio]
  return (
    <div className="bg-white border border-stone-200 hover:border-stone-300 hover:bg-stone-50/50 transition-all flex items-center gap-4 px-4 py-3">
      {/* Portfolio dot */}
      <div className={clsx('w-2 h-2 shrink-0', pm?.dot ?? 'bg-stone-300')} />

      {/* Name + aliases */}
      <div className="min-w-0 w-44 shrink-0">
        <div className="flex items-center gap-1.5">
          <Link href={`/project/${project.id}`} className="text-sm font-bold text-stone-800 hover:text-amber-700 truncate transition-colors">
            {project.id}
          </Link>
          {project.is_code_only && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-300 px-1 py-px font-medium shrink-0">
              code
            </span>
          )}
        </div>
        {project.aliases?.filter(a => a !== project.id).slice(0, 1).map(a => (
          <p key={a} className="text-xs text-stone-400 truncate">{a}</p>
        ))}
      </div>

      {/* Portfolio */}
      <div className="w-24 shrink-0">
        <PortfolioBadge portfolio={project.portfolio} />
      </div>

      {/* Status */}
      <div className="w-36 shrink-0">
        <StatusBadge status={project.status} />
      </div>

      {/* Priority */}
      <div className="w-8 shrink-0 text-center">
        <Tooltip label={`Priority ${project.priority}`}>
          <span className="text-xs text-stone-500 font-mono cursor-default">P{project.priority}</span>
        </Tooltip>
      </div>

      {/* Events */}
      <div className="w-24 shrink-0">
        <div className="flex items-baseline gap-1.5">
          <Tooltip label={`${project.events_recent} events in selected period`}>
            <span className="text-sm font-bold text-stone-700 tabular-nums cursor-default">{project.events_recent}</span>
          </Tooltip>
          <Tooltip label={`${project.events_total.toLocaleString()} all-time`}>
            <span className="text-xs text-stone-400 tabular-nums cursor-default">/ {project.events_total.toLocaleString()}</span>
          </Tooltip>
        </div>
      </div>

      {/* Surfaces */}
      <div className="w-32 shrink-0">
        <div className="flex gap-0.5 flex-wrap">
          {ALL_SURFACES.filter(s => (project.events_by_surface[s] || 0) > 0).map(s => {
            const meta = SURFACE_STYLE[s]
            return (
              <Tooltip key={s} label={`${meta.label}: ${project.events_by_surface[s]}`}>
                <span className={clsx('inline-flex items-center gap-0.5 text-xs px-1 py-px font-mono cursor-default border', meta.pill)}>
                  <span className={clsx('w-1 h-1', meta.dot)} />
                  {s.slice(0, 2).toUpperCase()}
                </span>
              </Tooltip>
            )
          })}
        </div>
      </div>

      {/* Top repo */}
      <div className="flex-1 min-w-0">
        {project.repos.length > 0 ? (
          <Tooltip label={`${project.repos[0].commits} commits${project.repos[0].last_commit ? ' · ' + timeAgo(project.repos[0].last_commit) : ''}`}>
            <span className="text-xs font-mono text-stone-500 truncate block cursor-default">{project.repos[0].name}</span>
          </Tooltip>
        ) : (
          <span className="text-xs text-stone-300">—</span>
        )}
      </div>

      {/* Themes */}
      <div className="w-40 shrink-0 hidden xl:flex flex-wrap gap-0.5">
        {project.themes.slice(0, 2).map(t => (
          <span key={t} className="text-xs bg-stone-50 text-stone-500 border border-stone-200 px-1 py-px truncate max-w-[80px]">
            #{t}
          </span>
        ))}
        {project.themes.length === 0 && <span className="text-xs text-stone-300 italic">—</span>}
      </div>

      {/* Last activity */}
      <div className="w-20 shrink-0 text-right">
        {project.last_activity ? (
          <Tooltip label={new Date(project.last_activity).toLocaleString()}>
            <span className="text-xs text-stone-500 cursor-default">{timeAgo(project.last_activity)}</span>
          </Tooltip>
        ) : (
          <span className="text-xs text-stone-300">—</span>
        )}
      </div>
    </div>
  )
}

// ─── Repo card view ───────────────────────────────────────────────────────────

interface EnrichedRepo {
  name: string
  commits: number
  last_commit: string | null
  project: string | null
  portfolio: string | null
  is_untracked: boolean
}

function RepoCard({ repo }: { repo: EnrichedRepo }) {
  const pm = repo.portfolio ? PORTFOLIO_META[repo.portfolio] : null
  return (
    <div className={clsx(
      'bg-white border shadow-sm hover:shadow-md transition-all flex flex-col p-4 gap-3',
      repo.is_untracked ? 'border-dashed border-stone-300' : 'border-stone-200 hover:border-stone-300'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-mono font-semibold text-stone-700 break-all leading-tight">{repo.name}</p>
        </div>
        <Tooltip label={`${repo.commits} commit${repo.commits !== 1 ? 's' : ''} in period`}>
          <div className="text-right shrink-0 cursor-default">
            <span className="text-xl font-bold text-stone-700 tabular-nums leading-none block">{repo.commits}</span>
            <span className="text-xs text-stone-400">commits</span>
          </div>
        </Tooltip>
      </div>

      {/* Attribution */}
      <div className="flex flex-wrap gap-1">
        {repo.project ? (
          <>
            <span className="text-xs bg-stone-100 text-stone-600 border border-stone-200 px-2 py-px font-mono">
              {repo.project}
            </span>
            {pm && <PortfolioBadge portfolio={repo.portfolio!} />}
          </>
        ) : (
          <span className="text-xs bg-stone-50 text-stone-400 border border-dashed border-stone-300 px-2 py-px italic">
            untracked
          </span>
        )}
      </div>

      {/* Surface indicator */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 bg-stone-400" />
        <span className="text-xs text-stone-400">github · build</span>
      </div>

      {/* Last commit */}
      <div className="mt-auto border-t border-stone-100 pt-2">
        {repo.last_commit ? (
          <Tooltip label={new Date(repo.last_commit).toLocaleString()}>
            <span className="text-xs text-stone-400 cursor-default">Last commit {timeAgo(repo.last_commit)}</span>
          </Tooltip>
        ) : (
          <span className="text-xs text-stone-300">No commit date</span>
        )}
      </div>
    </div>
  )
}

// ─── Repo list row ────────────────────────────────────────────────────────────

function RepoRow({ repo }: { repo: EnrichedRepo }) {
  const pm = repo.portfolio ? PORTFOLIO_META[repo.portfolio] : null
  return (
    <div className={clsx(
      'bg-white flex items-center gap-4 px-4 py-3 transition-all',
      repo.is_untracked
        ? 'border border-dashed border-stone-300 hover:border-stone-400'
        : 'border border-stone-200 hover:border-stone-300 hover:bg-stone-50/50'
    )}>
      {/* Dot */}
      <div className={clsx('w-2 h-2 shrink-0', pm?.dot ?? 'bg-stone-300')} />

      {/* Repo name */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-mono font-semibold text-stone-700 truncate block">{repo.name}</span>
      </div>

      {/* Project attribution */}
      <div className="w-36 shrink-0">
        {repo.project ? (
          <span className="text-xs bg-stone-100 text-stone-600 border border-stone-200 px-2 py-px font-mono truncate block">
            {repo.project}
          </span>
        ) : (
          <span className="text-xs text-stone-400 italic border border-dashed border-stone-300 px-2 py-px">
            untracked
          </span>
        )}
      </div>

      {/* Portfolio */}
      <div className="w-28 shrink-0">
        {pm ? <PortfolioBadge portfolio={repo.portfolio!} /> : <span className="text-xs text-stone-300">—</span>}
      </div>

      {/* Commits */}
      <div className="w-24 shrink-0">
        <Tooltip label={`${repo.commits} commits in selected period`}>
          <span className="text-sm font-bold text-stone-700 tabular-nums cursor-default">{repo.commits}</span>
        </Tooltip>
        <span className="text-xs text-stone-400 ml-1">commits</span>
      </div>

      {/* Surface */}
      <div className="w-20 shrink-0">
        <Tooltip label="GitHub · build">
          <span className="inline-flex items-center gap-1 text-xs text-stone-500 font-mono cursor-default">
            <span className="w-1.5 h-1.5 bg-stone-400" />
            GH
          </span>
        </Tooltip>
      </div>

      {/* Last commit */}
      <div className="w-24 shrink-0 text-right">
        {repo.last_commit ? (
          <Tooltip label={new Date(repo.last_commit).toLocaleString()}>
            <span className="text-xs text-stone-500 cursor-default">{timeAgo(repo.last_commit)}</span>
          </Tooltip>
        ) : (
          <span className="text-xs text-stone-300">—</span>
        )}
      </div>
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function InventoryApp() {
  const [data, setData]         = useState<ApiResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [days, setDays]         = useState(30)

  const [tab, setTab]                   = useState<Tab>('projects')
  const [viewMode, setViewMode]         = useState<ViewMode>('card')
  const [projectSort, setProjectSort]   = useState<ProjectSort>('priority')
  const [repoSort, setRepoSort]         = useState<RepoSort>('commits')
  const [search, setSearch]             = useState('')
  const [portfolioFilter, setPortfolioFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [focusFilter, setFocusFilter]   = useState<FocusFilter>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?days=${days}`)
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])

  // Derived: all repos enriched with project + portfolio info
  const allRepos = useMemo<EnrichedRepo[]>(() => {
    if (!data) return []
    const result: EnrichedRepo[] = []
    const seen = new Set<string>()

    for (const p of data.projects) {
      for (const r of p.repos) {
        if (seen.has(r.name)) continue
        seen.add(r.name)
        result.push({
          name: r.name,
          commits: r.commits,
          last_commit: r.last_commit,
          project: p.id,
          portfolio: p.portfolio,
          is_untracked: false,
        })
      }
    }
    for (const r of data.untracked_repos) {
      if (seen.has(r.name)) continue
      seen.add(r.name)
      result.push({
        name: r.name,
        commits: r.commits,
        last_commit: r.last_commit,
        project: null,
        portfolio: null,
        is_untracked: true,
      })
    }
    return result
  }, [data])

  const filteredProjects = useMemo(() => {
    if (!data) return []
    let list = [...data.projects]

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(p =>
        p.id.toLowerCase().includes(q) ||
        p.aliases?.some(a => a.toLowerCase().includes(q)) ||
        p.themes?.some(t => t.toLowerCase().includes(q))
      )
    }
    if (portfolioFilter) list = list.filter(p => p.portfolio === portfolioFilter)
    if (statusFilter)    list = list.filter(p => p.status === statusFilter)
    if (focusFilter === 'code-only') list = list.filter(p => p.is_code_only)
    if (focusFilter === 'has-comms') list = list.filter(p => !p.is_code_only)

    list.sort((a, b) => {
      if (projectSort === 'priority')  return a.priority - b.priority
      if (projectSort === 'recent')    return b.events_recent - a.events_recent
      if (projectSort === 'alltime')   return b.events_total - a.events_total
      if (projectSort === 'name')      return a.id.localeCompare(b.id)
      if (projectSort === 'portfolio') {
        const order = ['worksona', 'atomic47', 'nutabu', 'aimqc', 'market-research', 'personal']
        return (order.indexOf(a.portfolio) - order.indexOf(b.portfolio)) || a.priority - b.priority
      }
      return 0
    })
    return list
  }, [data, search, portfolioFilter, statusFilter, focusFilter, projectSort])

  const filteredRepos = useMemo(() => {
    let list = [...allRepos]
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r => r.name.toLowerCase().includes(q) || r.project?.toLowerCase().includes(q))
    if (portfolioFilter) list = list.filter(r => r.portfolio === portfolioFilter)

    list.sort((a, b) => {
      if (repoSort === 'commits')     return b.commits - a.commits
      if (repoSort === 'last_commit') {
        const ta = a.last_commit ? new Date(a.last_commit).getTime() : 0
        const tb = b.last_commit ? new Date(b.last_commit).getTime() : 0
        return tb - ta
      }
      if (repoSort === 'name') return a.name.localeCompare(b.name)
      return 0
    })
    return list
  }, [allRepos, search, portfolioFilter, repoSort])

  const statuses = useMemo(
    () => data ? [...new Set(data.projects.map(p => p.status))] : [],
    [data]
  )

  const portfolios = useMemo(
    () => data?.portfolios ?? [],
    [data]
  )

  // Summary stats
  const totalProjects  = data?.projects.length ?? 0
  const totalRepos     = allRepos.length
  const untrackedCount = allRepos.filter(r => r.is_untracked).length
  const activeCount    = data?.projects.filter(p => p.events_recent > 0).length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#f5f0e8' }}>
      {/* ── Toolbar ── */}
      <div
        className="shrink-0 border-b border-stone-300 px-4 py-3 flex flex-wrap items-center gap-3"
        style={{ background: '#ede8df' }}
      >
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects, aliases, themes…"
            className="w-64 text-xs bg-white border border-stone-300 px-3 py-1.5 pr-7 text-stone-700 placeholder-stone-400 focus:outline-none focus:border-amber-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-sm leading-none"
            >×</button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border border-stone-300">
          {([['projects', `Projects (${totalProjects})`], ['repos', `Repos (${totalRepos})`]] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx('text-xs px-3 py-1.5 font-medium transition-colors', tab === t ? 'bg-amber-700 text-white' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/60')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex border border-stone-300">
          <button
            onClick={() => setViewMode('card')}
            className={clsx('text-xs px-2.5 py-1.5 font-medium transition-colors', viewMode === 'card' ? 'bg-stone-700 text-white' : 'text-stone-500 hover:text-stone-800')}
            title="Card view"
          >
            ⊞
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={clsx('text-xs px-2.5 py-1.5 font-medium transition-colors', viewMode === 'list' ? 'bg-stone-700 text-white' : 'text-stone-500 hover:text-stone-800')}
            title="List view"
          >
            ☰
          </button>
        </div>

        {/* Sort */}
        <select
          value={tab === 'projects' ? projectSort : repoSort}
          onChange={e => tab === 'projects'
            ? setProjectSort(e.target.value as ProjectSort)
            : setRepoSort(e.target.value as RepoSort)
          }
          className="text-xs bg-white border border-stone-300 px-2 py-1.5 text-stone-600 focus:outline-none focus:border-amber-400"
        >
          {(tab === 'projects' ? PROJECT_SORT_OPTIONS : REPO_SORT_OPTIONS).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Range */}
        <div className="flex border border-stone-300">
          {DAY_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={clsx('text-xs px-2.5 py-1.5 font-medium transition-colors', days === value ? 'bg-stone-600 text-white' : 'text-stone-500 hover:text-stone-800')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="h-5 w-px bg-stone-300" />

        {/* Portfolio filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-stone-400 font-semibold uppercase tracking-wide">Portfolio:</span>
          {['all', ...portfolios].map(p => {
            const active = p === 'all' ? portfolioFilter === null : portfolioFilter === p
            const pm = PORTFOLIO_META[p]
            return (
              <button
                key={p}
                onClick={() => setPortfolioFilter(p === 'all' ? null : p)}
                className={clsx(
                  'text-xs px-2 py-1 border font-medium transition-colors',
                  active
                    ? (pm ? `${pm.bg} ${pm.text} ${pm.border}` : 'bg-stone-700 text-white border-stone-700')
                    : 'text-stone-500 border-stone-200 hover:border-stone-400'
                )}
              >
                {p === 'all' ? 'All' : (pm?.label ?? p)}
              </button>
            )
          })}
        </div>

        {/* Status filter (projects only) */}
        {tab === 'projects' && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-stone-400 font-semibold uppercase tracking-wide">Status:</span>
            <button
              onClick={() => setStatusFilter(null)}
              className={clsx('text-xs px-2 py-1 border font-medium transition-colors', statusFilter === null ? 'bg-stone-700 text-white border-stone-700' : 'text-stone-500 border-stone-200 hover:border-stone-400')}
            >All</button>
            {statuses.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  'text-xs px-2 py-1 border font-medium transition-colors',
                  statusFilter === s
                    ? (STATUS_STYLE[s] ?? 'bg-stone-700 text-white border-stone-700')
                    : 'text-stone-500 border-stone-200 hover:border-stone-400'
                )}
              >
                {s.replace(/-/g, ' ')}
              </button>
            ))}
          </div>
        )}

        {/* Focus filter (projects only) */}
        {tab === 'projects' && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-stone-400 font-semibold uppercase tracking-wide">Focus:</span>
            {([['all', 'All'], ['code-only', 'Code only'], ['has-comms', 'Has comms']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFocusFilter(id)}
                className={clsx(
                  'text-xs px-2 py-1 border font-medium transition-colors',
                  focusFilter === id ? 'bg-amber-700 text-white border-amber-700' : 'text-stone-500 border-stone-200 hover:border-stone-400'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Summary counts (right-aligned) */}
        <div className="ml-auto flex items-center gap-3 text-xs text-stone-400 shrink-0">
          {tab === 'projects' ? (
            <>
              <span><strong className="text-stone-600 tabular-nums">{filteredProjects.length}</strong> shown</span>
              <span><strong className="text-stone-600 tabular-nums">{activeCount}</strong> active</span>
            </>
          ) : (
            <>
              <span><strong className="text-stone-600 tabular-nums">{filteredRepos.length}</strong> shown</span>
              <span><strong className="text-stone-600 tabular-nums">{untrackedCount}</strong> untracked</span>
            </>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center h-48">
            <span className="text-sm text-stone-400 animate-pulse">Loading inventory…</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-48">
            <div className="bg-red-50 border border-red-200 p-5 max-w-md">
              <p className="text-sm text-red-600 font-semibold mb-1">Failed to load</p>
              <p className="text-xs text-red-400 font-mono break-all">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && tab === 'projects' && (
          <>
            {filteredProjects.length === 0 ? (
              <div className="text-center py-16 text-stone-400 text-sm">No projects match your filters.</div>
            ) : viewMode === 'card' ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {filteredProjects.map(p => <ProjectCard key={p.id} project={p} />)}
              </div>
            ) : (
              <div className="space-y-0.5">
                {/* List header */}
                <div className="flex items-center gap-4 px-4 py-2 text-xs text-stone-400 font-semibold uppercase tracking-wide bg-stone-100 border border-stone-200">
                  <div className="w-2 shrink-0" />
                  <div className="w-44 shrink-0">Project</div>
                  <div className="w-24 shrink-0">Portfolio</div>
                  <div className="w-36 shrink-0">Status</div>
                  <div className="w-8 shrink-0 text-center">Pri</div>
                  <div className="w-24 shrink-0">Events</div>
                  <div className="w-32 shrink-0">Surfaces</div>
                  <div className="flex-1">Top repo</div>
                  <div className="w-40 shrink-0 hidden xl:block">Themes</div>
                  <div className="w-20 shrink-0 text-right">Last active</div>
                </div>
                {filteredProjects.map(p => <ProjectRow key={p.id} project={p} />)}
              </div>
            )}
          </>
        )}

        {!loading && !error && tab === 'repos' && (
          <>
            {filteredRepos.length === 0 ? (
              <div className="text-center py-16 text-stone-400 text-sm">No repos match your filters.</div>
            ) : viewMode === 'card' ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {filteredRepos.map(r => <RepoCard key={r.name} repo={r} />)}
              </div>
            ) : (
              <div className="space-y-0.5">
                {/* List header */}
                <div className="flex items-center gap-4 px-4 py-2 text-xs text-stone-400 font-semibold uppercase tracking-wide bg-stone-100 border border-stone-200">
                  <div className="w-2 shrink-0" />
                  <div className="flex-1">Repository</div>
                  <div className="w-36 shrink-0">Project</div>
                  <div className="w-28 shrink-0">Portfolio</div>
                  <div className="w-24 shrink-0">Commits</div>
                  <div className="w-20 shrink-0">Surface</div>
                  <div className="w-24 shrink-0 text-right">Last commit</div>
                </div>
                {filteredRepos.map(r => <RepoRow key={r.name} repo={r} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
