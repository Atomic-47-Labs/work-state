'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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

interface WorkEvent {
  id: string
  surface: string
  type: string
  timestamp: string
  project: string
  themes: string[]
  evidence: Record<string, string | number | boolean | string[]>
  metrics: Record<string, number>
}

// ─── Style constants ──────────────────────────────────────────────────────────

const SURFACE_STYLE: Record<string, { label: string; pill: string; dot: string; bar: string }> = {
  github:  { label: 'GitHub',  pill: 'bg-stone-100 text-stone-600 border border-stone-300',   dot: 'bg-stone-500',   bar: 'bg-stone-400' },
  slack:   { label: 'Slack',   pill: 'bg-purple-50 text-purple-700 border border-purple-200', dot: 'bg-purple-500',  bar: 'bg-purple-400' },
  gmail:   { label: 'Gmail',   pill: 'bg-red-50 text-red-700 border border-red-200',          dot: 'bg-red-500',     bar: 'bg-red-400' },
  gdocs:   { label: 'GDocs',   pill: 'bg-blue-50 text-blue-700 border border-blue-200',       dot: 'bg-blue-500',    bar: 'bg-blue-400' },
  scsiwyg:  { label: 'Scsiwyg',  pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200',  dot: 'bg-emerald-500',  bar: 'bg-emerald-400' },
  linkedin: { label: 'LinkedIn', pill: 'bg-blue-50 text-blue-700 border border-blue-300',           dot: 'bg-blue-600',     bar: 'bg-blue-500' },
  x:        { label: 'X',        pill: 'bg-stone-900 text-stone-100 border border-stone-700',        dot: 'bg-stone-800',    bar: 'bg-stone-700' },
  substack: { label: 'Substack', pill: 'bg-orange-50 text-orange-700 border border-orange-300',     dot: 'bg-orange-500',   bar: 'bg-orange-400' },
}

const STATUS_STYLE: Record<string, string> = {
  'active':                    'bg-emerald-50 text-emerald-700 border border-emerald-300',
  'designed':                  'bg-sky-50 text-sky-700 border border-sky-200',
  'production-bible-complete': 'bg-amber-50 text-amber-700 border border-amber-300',
}

const TYPE_COLOR: Record<string, string> = {
  build:   'bg-stone-400',
  share:   'bg-amber-500',
  receive: 'bg-sky-400',
  draft:   'bg-emerald-400',
  publish: 'bg-orange-400',
  decide:  'bg-purple-400',
  learn:   'bg-teal-400',
}

const TYPE_TEXT: Record<string, string> = {
  build:   'text-stone-600',
  share:   'text-amber-700',
  receive: 'text-sky-700',
  draft:   'text-emerald-700',
  publish: 'text-orange-700',
  decide:  'text-purple-700',
  learn:   'text-teal-700',
}

const TYPE_BG: Record<string, string> = {
  build:   'bg-stone-100',
  share:   'bg-amber-50',
  receive: 'bg-sky-50',
  draft:   'bg-emerald-50',
  publish: 'bg-orange-50',
  decide:  'bg-purple-50',
  learn:   'bg-teal-50',
}

const PORTFOLIO_META: Record<string, { label: string; dot: string; border: string; bg: string; text: string }> = {
  worksona:          { label: 'Worksona',        dot: 'bg-amber-500',   border: 'border-amber-300',   bg: 'bg-amber-50',   text: 'text-amber-800' },
  atomic47:          { label: 'Atomic47',        dot: 'bg-orange-500',  border: 'border-orange-300',  bg: 'bg-orange-50',  text: 'text-orange-800' },
  nutabu:            { label: 'Nutabu',          dot: 'bg-rose-500',    border: 'border-rose-300',    bg: 'bg-rose-50',    text: 'text-rose-800' },
  aimqc:             { label: 'AIMQC',           dot: 'bg-sky-500',     border: 'border-sky-300',     bg: 'bg-sky-50',     text: 'text-sky-800' },
  'market-research': { label: 'Market Research', dot: 'bg-violet-500',  border: 'border-violet-300',  bg: 'bg-violet-50',  text: 'text-violet-800' },
  personal:          { label: 'Personal',        dot: 'bg-teal-500',    border: 'border-teal-300',    bg: 'bg-teal-50',    text: 'text-teal-700' },
}

const DAY_OPTIONS = [
  { label: '7d',  value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 365 },
]

const ALL_SURFACES = ['github', 'slack', 'gmail', 'gdocs', 'scsiwyg', 'linkedin', 'x', 'substack']
const ALL_TYPES    = ['build', 'share', 'receive', 'draft', 'publish', 'decide', 'learn']

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getExcerpt(ev: WorkEvent): string {
  const e = ev.evidence
  if (ev.surface === 'gmail')  return String(e.subject  || e.excerpt       || ev.type)
  if (ev.surface === 'gdocs')  return String(e.title    || ev.type)
  if (ev.surface === 'github') return String(e.message  || ev.type)
  if (ev.surface === 'slack')  return String(e.text_excerpt || ev.type)
  return ev.type
}

function getMeta(ev: WorkEvent): string | null {
  const e = ev.evidence
  const m = ev.metrics || {}
  if (ev.surface === 'github') {
    const parts: string[] = []
    if (e.repo)          parts.push(String(e.repo))
    if (m.files_changed) parts.push(`${m.files_changed} files`)
    if (e.is_merge)      parts.push('merge')
    return parts.join(' · ') || null
  }
  if (ev.surface === 'slack') {
    const parts: string[] = []
    if (e.channel_name)            parts.push(String(e.channel_name))
    if (e.is_dm)                   parts.push('DM')
    if (e.direction === 'inbound') parts.push('received')
    if (m.text_word_count)         parts.push(`${m.text_word_count}w`)
    return parts.join(' · ') || null
  }
  if (ev.surface === 'gmail') {
    const parts: string[] = []
    if (e.direction === 'inbound'  && e.from) parts.push(`From ${e.from}`)
    if (e.direction === 'outbound' && e.to) {
      const first = Array.isArray(e.to) ? (e.to as string[])[0] : String(e.to)
      parts.push(`To ${first}`)
    }
    if (e.is_reply) parts.push('reply')
    return parts.join(' · ') || null
  }
  if (ev.surface === 'gdocs') {
    const parts: string[] = []
    if (e.subtype)              parts.push(String(e.subtype))
    if (m.current_word_count)   parts.push(`${m.current_word_count.toLocaleString()} words`)
    if (m.word_delta && m.word_delta !== m.current_word_count)
      parts.push(`Δ${m.word_delta > 0 ? '+' : ''}${m.word_delta}`)
    return parts.join(' · ') || null
  }
  return null
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

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={clsx('border p-4 flex flex-col gap-1', accent ? 'bg-amber-50 border-amber-200' : 'bg-white border-stone-200')}>
      <div className={clsx('text-2xl font-bold tabular-nums leading-none', accent ? 'text-amber-700' : 'text-stone-800')}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-stone-500">{label}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, height = 'h-12' }: { data: SparkPoint[]; height?: string }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className={clsx('flex items-end gap-px w-full', height)}>
      {data.map(({ date, count }) => (
        <Tooltip key={date} label={`${date}: ${count} event${count !== 1 ? 's' : ''}`}>
          <div
            style={{ height: count > 0 ? `${Math.max((count / max) * 100, 8)}%` : '6%' }}
            className={clsx('flex-1 cursor-default transition-all', count > 0 ? 'bg-amber-400/80 hover:bg-amber-500' : 'bg-stone-200')}
          />
        </Tooltip>
      ))}
    </div>
  )
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function ActivityHeatmap({ events, days }: { events: WorkEvent[]; days: number }) {
  const cells = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of events) {
      const d = e.timestamp?.split('T')[0]
      if (d) map[d] = (map[d] || 0) + 1
    }
    const result: { date: string; count: number }[] = []
    const now = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      result.push({ date: key, count: map[key] || 0 })
    }
    return result
  }, [events, days])

  const max = Math.max(...cells.map(c => c.count), 1)

  const intensity = (count: number) => {
    if (count === 0) return 'bg-stone-100'
    const pct = count / max
    if (pct < 0.25) return 'bg-amber-200'
    if (pct < 0.5)  return 'bg-amber-300'
    if (pct < 0.75) return 'bg-amber-400'
    return 'bg-amber-500'
  }

  // Group into weeks for display
  const weeks: { date: string; count: number }[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return (
    <div className="flex gap-px flex-wrap">
      {cells.map(({ date, count }) => (
        <Tooltip key={date} label={`${date}: ${count} event${count !== 1 ? 's' : ''}`}>
          <div className={clsx('w-3 h-3 cursor-default transition-colors', intensity(count))} />
        </Tooltip>
      ))}
    </div>
  )
}

// ─── Breakdown bar ────────────────────────────────────────────────────────────

function BreakdownBar({ label, count, max, colorClass }: { label: string; count: number; max: number; colorClass: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-stone-500 w-16 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
        <div className={clsx('h-full transition-all', colorClass)} style={{ width: `${(count / max) * 100}%` }} />
      </div>
      <span className="text-xs text-stone-500 w-8 text-right tabular-nums shrink-0">{count}</span>
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function ProjectDetailApp() {
  const params   = useParams()
  const router   = useRouter()
  const projectId = typeof params.id === 'string' ? params.id : ''

  const [project, setProject]       = useState<Project | null>(null)
  const [events, setEvents]         = useState<WorkEvent[]>([])
  const [loading, setLoading]       = useState(true)
  const [eventsLoading, setEventsLoading] = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [days, setDays]             = useState(30)

  // Event timeline filters
  const [surfaceFilter, setSurfaceFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter]       = useState<string | null>(null)
  const [search, setSearch]               = useState('')

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?days=${days}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const found = data.projects.find((p: Project) => p.id === projectId)
      if (!found) throw new Error(`Project "${projectId}" not found`)
      setProject(found)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId, days])

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true)
    try {
      const res = await fetch(`/api/events?project=${projectId}&days=${days}&limit=300`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setEvents(data.events || [])
    } catch {
      setEvents([])
    } finally {
      setEventsLoading(false)
    }
  }, [projectId, days])

  useEffect(() => {
    setLoading(true)
    fetchProject()
    fetchEvents()
  }, [fetchProject, fetchEvents])

  const filteredEvents = useMemo(() => {
    let list = [...events]
    if (surfaceFilter) list = list.filter(e => e.surface === surfaceFilter)
    if (typeFilter)    list = list.filter(e => e.type === typeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e => getExcerpt(e).toLowerCase().includes(q) || getMeta(e)?.toLowerCase().includes(q) || e.themes?.some(t => t.toLowerCase().includes(q)))
    }
    return list
  }, [events, surfaceFilter, typeFilter, search])

  // Compute surface + type maxes from project data
  const surfaceEntries = project
    ? Object.entries(project.events_by_surface).sort((a, b) => b[1] - a[1])
    : []
  const typeEntries = project
    ? Object.entries(project.events_by_type).sort((a, b) => b[1] - a[1])
    : []
  const surfaceMax = Math.max(...surfaceEntries.map(([, c]) => c), 1)
  const typeMax    = Math.max(...typeEntries.map(([, c]) => c), 1)
  const repoMax    = Math.max(...(project?.repos.map(r => r.commits) ?? []), 1)

  // Surfaces present in events for filter pills
  const presentSurfaces = useMemo(
    () => [...new Set(events.map(e => e.surface))],
    [events]
  )
  const presentTypes = useMemo(
    () => [...new Set(events.map(e => e.type))],
    [events]
  )

  const pm = project ? PORTFOLIO_META[project.portfolio] : null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: '#f5f0e8' }}>
        <span className="text-sm text-stone-400 animate-pulse">Loading project…</span>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: '#f5f0e8' }}>
        <div className="bg-red-50 border border-red-200 p-5 max-w-md">
          <p className="text-sm text-red-600 font-semibold mb-1">Project not found</p>
          <p className="text-xs text-red-400 font-mono break-all">{error}</p>
          <button onClick={() => router.push('/')} className="mt-3 text-xs text-stone-500 hover:text-stone-800 underline">← Back to Kanban</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#f5f0e8' }}>

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-stone-300 px-5 py-3 flex items-center gap-4" style={{ background: '#ede8df' }}>
        <button
          onClick={() => router.back()}
          className="text-xs text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 px-2 py-1 transition-colors shrink-0"
        >
          ← Back
        </button>

        <div className="h-4 w-px bg-stone-300" />

        {/* Project identity */}
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          {pm && <div className={clsx('w-2 h-2 shrink-0', pm.dot)} />}
          <h1 className="text-sm font-bold text-stone-800">{project.id}</h1>
          {project.aliases?.filter(a => a !== project.id).map(a => (
            <span key={a} className="text-xs text-stone-400">{a}</span>
          ))}
          <div className="h-3 w-px bg-stone-300" />
          {pm && (
            <span className={clsx('text-xs px-2 py-px border font-medium', pm.border, pm.bg, pm.text)}>
              {pm.label}
            </span>
          )}
          <span className={clsx('text-xs px-2 py-px border font-medium', STATUS_STYLE[project.status] ?? 'bg-stone-100 text-stone-600 border-stone-200')}>
            {project.status.replace(/-/g, ' ')}
          </span>
          <span className="text-xs bg-stone-100 text-stone-500 border border-stone-200 px-1.5 py-px font-mono">
            P{project.priority}
          </span>
          {project.is_code_only && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-300 px-1.5 py-px font-medium">
              code only
            </span>
          )}
        </div>

        {/* Range selector */}
        <div className="flex border border-stone-300 shrink-0">
          {DAY_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={clsx('text-xs px-2.5 py-1.5 font-medium transition-colors', days === value ? 'bg-amber-700 text-white' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/60')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-5 max-w-screen-2xl mx-auto">

          {/* ── Stats row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={`events in last ${days === 365 ? 'year' : days + ' days'}`}
              value={project.events_recent}
              accent
            />
            <StatCard
              label="all-time events"
              value={project.events_total}
            />
            <StatCard
              label="attributed repos"
              value={project.repos.length}
              sub={project.repos[0]?.name ?? undefined}
            />
            <StatCard
              label="last active"
              value={project.last_activity ? timeAgo(project.last_activity) : '—'}
              sub={project.last_activity ? formatDate(project.last_activity) : undefined}
            />
          </div>

          {/* ── Sparkline + heatmap ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white border border-stone-200 p-4">
              <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">14-day activity</h2>
              <Sparkline data={project.sparkline} height="h-16" />
              <div className="flex justify-between text-xs text-stone-300 mt-1">
                <span>{project.sparkline[0]?.date}</span>
                <span>today</span>
              </div>
            </div>
            <div className="bg-white border border-stone-200 p-4">
              <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">
                Activity — last {days === 365 ? '365' : days} days
                <span className="normal-case font-normal text-stone-300 ml-2">1 cell = 1 day</span>
              </h2>
              {eventsLoading ? (
                <div className="h-16 flex items-center justify-center text-xs text-stone-300 animate-pulse">Loading…</div>
              ) : (
                <ActivityHeatmap events={events} days={Math.min(days, 90)} />
              )}
            </div>
          </div>

          {/* ── Main two-column ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

            {/* ── Left: analytics ── */}
            <div className="lg:col-span-2 space-y-4">

              {/* Surface breakdown */}
              {surfaceEntries.length > 0 && (
                <div className="bg-white border border-stone-200 p-4 space-y-2.5">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">By surface</h2>
                  {surfaceEntries.map(([s, c]) => {
                    const meta = SURFACE_STYLE[s]
                    return (
                      <BreakdownBar key={s} label={meta?.label ?? s} count={c} max={surfaceMax} colorClass={meta?.bar ?? 'bg-stone-400'} />
                    )
                  })}
                </div>
              )}

              {/* Type breakdown */}
              {typeEntries.length > 0 && (
                <div className="bg-white border border-stone-200 p-4 space-y-2.5">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">By type</h2>
                  {typeEntries.map(([t, c]) => (
                    <BreakdownBar key={t} label={t} count={c} max={typeMax} colorClass={TYPE_COLOR[t] ?? 'bg-stone-300'} />
                  ))}
                </div>
              )}

              {/* Repos */}
              {project.repos.length > 0 && (
                <div className="bg-white border border-stone-200 p-4">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Repos</h2>
                  <div className="space-y-3">
                    {project.repos.map(r => (
                      <div key={r.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-stone-700 truncate font-semibold">{r.name}</span>
                          <Tooltip label={`${r.commits} commit${r.commits !== 1 ? 's' : ''}`}>
                            <span className="text-xs text-stone-500 tabular-nums shrink-0 cursor-default">{r.commits}c</span>
                          </Tooltip>
                        </div>
                        <div className="bg-stone-100 h-1.5 overflow-hidden">
                          <div className="h-full bg-stone-400" style={{ width: `${(r.commits / repoMax) * 100}%` }} />
                        </div>
                        {r.last_commit && (
                          <p className="text-xs text-stone-400">Last commit {timeAgo(r.last_commit)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Themes */}
              {project.themes.length > 0 && (
                <div className="bg-white border border-stone-200 p-4">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Themes</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {project.themes.map(t => (
                      <span key={t} className="text-xs bg-stone-50 text-stone-600 border border-stone-200 px-2 py-1 font-medium">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right: event timeline ── */}
            <div className="lg:col-span-3 bg-white border border-stone-200 flex flex-col" style={{ minHeight: '520px' }}>

              {/* Timeline header */}
              <div className="px-4 pt-4 pb-3 border-b border-stone-100 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                    Event timeline
                    <span className="normal-case font-normal text-stone-300 ml-2">
                      {filteredEvents.length}{events.length !== filteredEvents.length ? ` / ${events.length}` : ''} events
                    </span>
                  </h2>
                  {(surfaceFilter || typeFilter || search) && (
                    <button
                      onClick={() => { setSurfaceFilter(null); setTypeFilter(null); setSearch('') }}
                      className="text-xs text-stone-400 hover:text-stone-700 underline"
                    >
                      Clear filters
                    </button>
                  )}
                </div>

                {/* Search */}
                <div className="relative">
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search events…"
                    className="w-full text-xs bg-stone-50 border border-stone-200 px-3 py-1.5 text-stone-700 placeholder-stone-300 focus:outline-none focus:border-amber-400"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-sm">×</button>
                  )}
                </div>

                {/* Surface filter pills */}
                {presentSurfaces.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {presentSurfaces.map(s => {
                      const meta = SURFACE_STYLE[s]
                      const active = surfaceFilter === s
                      return (
                        <button
                          key={s}
                          onClick={() => setSurfaceFilter(active ? null : s)}
                          className={clsx('inline-flex items-center gap-1 text-xs px-2 py-0.5 border font-mono transition-colors', active ? meta?.pill : 'bg-stone-50 text-stone-400 border-stone-200 hover:border-stone-300')}
                        >
                          <span className={clsx('w-1.5 h-1.5', active ? meta?.dot : 'bg-stone-300')} />
                          {s.slice(0, 2).toUpperCase()}
                          <span className="opacity-60">{project.events_by_surface[s] || 0}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Type filter pills */}
                {presentTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {presentTypes.map(t => {
                      const active = typeFilter === t
                      return (
                        <button
                          key={t}
                          onClick={() => setTypeFilter(active ? null : t)}
                          className={clsx(
                            'text-xs px-2 py-0.5 border font-medium transition-colors',
                            active
                              ? clsx(TYPE_BG[t] ?? 'bg-stone-50', TYPE_TEXT[t] ?? 'text-stone-600', 'border-current')
                              : 'bg-stone-50 text-stone-400 border-stone-200 hover:border-stone-300'
                          )}
                        >
                          {t}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Event list */}
              <div className="flex-1 overflow-y-auto">
                {eventsLoading && (
                  <div className="flex items-center justify-center py-16 text-xs text-stone-400 animate-pulse">Loading events…</div>
                )}
                {!eventsLoading && filteredEvents.length === 0 && (
                  <div className="flex items-center justify-center py-16 text-xs text-stone-300">No events match your filters</div>
                )}
                {!eventsLoading && filteredEvents.length > 0 && (
                  <div className="divide-y divide-stone-50">
                    {filteredEvents.map(ev => {
                      const excerpt = getExcerpt(ev)
                      const meta    = getMeta(ev)
                      const sStyle  = SURFACE_STYLE[ev.surface] ?? { label: ev.surface, pill: 'bg-stone-100 text-stone-600 border border-stone-200', dot: 'bg-stone-400', bar: 'bg-stone-400' }
                      const tColor  = TYPE_COLOR[ev.type] ?? 'bg-stone-300'
                      const tBg     = TYPE_BG[ev.type] ?? 'bg-stone-50'
                      const tText   = TYPE_TEXT[ev.type] ?? 'text-stone-600'
                      return (
                        <div key={ev.id} className="px-4 py-3 hover:bg-stone-50/70 transition-colors">
                          <div className="flex items-start gap-3">
                            {/* Left: surface dot + timestamp */}
                            <div className="shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
                              <span className={clsx('w-2 h-2 shrink-0', sStyle.dot)} />
                            </div>
                            {/* Right: content */}
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs text-stone-400 tabular-nums">{formatDateTime(ev.timestamp)}</span>
                                <span className={clsx('inline-flex items-center gap-0.5 text-xs px-1.5 py-px font-mono border', sStyle.pill)}>
                                  <span className={clsx('w-1 h-1', sStyle.dot)} />
                                  {sStyle.label}
                                </span>
                                <span className={clsx('text-xs px-1.5 py-px font-medium border', tBg, tText, 'border-current/20')}>
                                  {ev.type}
                                </span>
                                {timeAgo(ev.timestamp) !== 'just now' && (
                                  <span className="text-xs text-stone-300">{timeAgo(ev.timestamp)}</span>
                                )}
                              </div>
                              <p className="text-xs text-stone-700 leading-snug">{excerpt}</p>
                              {meta && <p className="text-xs text-stone-400 leading-tight">{meta}</p>}
                              {ev.themes?.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {ev.themes.map(t => (
                                    <span key={t} className="text-xs text-stone-400 bg-stone-50 border border-stone-100 px-1.5 py-px">#{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
