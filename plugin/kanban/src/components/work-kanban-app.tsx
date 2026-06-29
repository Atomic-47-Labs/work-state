'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  closestCorners,
  DragStartEvent,
  DragEndEvent,
  CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ─── Collision detection: route by drag type so columns only collide with ─────
// columns, and cards/repos only collide with portfolio zones / project cards.

const mixedCollisionDetection: CollisionDetection = (args) => {
  const dragType = (args.active.data.current as { type?: string })?.type

  if (dragType === 'column') {
    // Only consider col:: sortable targets
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(c =>
        String(c.id).startsWith('col::')
      ),
    })
  }

  // Cards and repos: exclude col:: sortable targets, use closest corners for precision
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(c =>
      !String(c.id).startsWith('col::')
    ),
  })
}

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

type GroupBy    = 'portfolio' | 'status' | 'activity' | 'timeline'
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

const TYPE_BAR_COLOR: Record<string, string> = {
  build:   'bg-stone-400',
  share:   'bg-amber-500',
  receive: 'bg-sky-400',
  draft:   'bg-emerald-400',
  publish: 'bg-orange-400',
  decide:      'bg-purple-400',
  learn:       'bg-teal-400',
  'tool-burst': 'bg-violet-400',
}

const PORTFOLIO_META: Record<string, { label: string; colBorder: string; colBg: string; heading: string; dot: string }> = {
  worksona:          { label: 'Worksona',        colBorder: 'border-amber-300/70',   colBg: 'bg-amber-50/40',   heading: 'text-amber-800',   dot: 'bg-amber-500' },
  atomic47:          { label: 'Atomic47',        colBorder: 'border-orange-300/70',  colBg: 'bg-orange-50/40',  heading: 'text-orange-800',  dot: 'bg-orange-500' },
  nutabu:            { label: 'Nutabu',          colBorder: 'border-rose-300/70',    colBg: 'bg-rose-50/40',    heading: 'text-rose-800',    dot: 'bg-rose-500' },
  aimqc:             { label: 'AIMQC',           colBorder: 'border-sky-300/70',     colBg: 'bg-sky-50/40',     heading: 'text-sky-800',     dot: 'bg-sky-500' },
  'market-research': { label: 'Market Research', colBorder: 'border-violet-300/70',  colBg: 'bg-violet-50/40',  heading: 'text-violet-800',  dot: 'bg-violet-500' },
  personal:          { label: 'Personal',        colBorder: 'border-teal-300/70',    colBg: 'bg-teal-50/40',    heading: 'text-teal-700',    dot: 'bg-teal-500' },
}

const ALL_SURFACES = ['github', 'slack', 'gmail', 'gdocs', 'scsiwyg', 'claude-code', 'linkedin', 'x', 'substack']
const ALL_TYPES    = ['build', 'tool-burst', 'share', 'receive', 'draft', 'publish', 'decide', 'learn']

const DAY_OPTIONS = [
  { label: 'Today',    value: 1 },
  { label: '7 days',   value: 7 },
  { label: '30 days',  value: 30 },
  { label: '120 days', value: 120 },
  { label: 'All time', value: 365 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatEventTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getEventExcerpt(ev: WorkEvent): string {
  const e = ev.evidence
  if (ev.surface === 'gmail')  return String(e.subject  || e.excerpt       || ev.type)
  if (ev.surface === 'gdocs')  return String(e.title    || ev.type)
  if (ev.surface === 'github') return String(e.message  || ev.type)
  if (ev.surface === 'slack')   return String(e.text_excerpt || ev.type)
  if (ev.surface === 'scsiwyg') return String(e.title || ev.type)
  if (ev.surface === 'linkedin') return String(e.text_excerpt || e.title || ev.type)
  if (ev.surface === 'x')       return String(e.text_excerpt || ev.type)
  if (ev.surface === 'substack') return String(e.title || ev.type)
  if (ev.surface === 'claude-code') {
    if (ev.type === 'tool-burst') return `${e.dominant_tool || 'tool'} burst · ${e.tool_calls_total || ''} calls`
    const cwd = typeof e.cwd === 'string' ? e.cwd : ''
    return String(e.summary || cwd.split('/').pop() || 'session')
  }
  return ev.type
}

function getEventMeta(ev: WorkEvent): string | null {
  const e = ev.evidence
  const m = ev.metrics || {}
  if (ev.surface === 'github') {
    const parts: string[] = []
    if (e.repo)           parts.push(String(e.repo))
    if (m.files_changed)  parts.push(`${m.files_changed} files`)
    if (e.is_merge)       parts.push('merge')
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
    if (e.is_reply)   parts.push('reply')
    if (m.recipient_count && m.recipient_count > 1) parts.push(`${m.recipient_count} recipients`)
    return parts.join(' · ') || null
  }
  if (ev.surface === 'gdocs') {
    const parts: string[] = []
    if (e.subtype)                parts.push(String(e.subtype))
    if (m.current_word_count)     parts.push(`${m.current_word_count.toLocaleString()} words`)
    if (m.word_delta && m.word_delta !== m.current_word_count)
      parts.push(`Δ${m.word_delta > 0 ? '+' : ''}${m.word_delta}`)
    return parts.join(' · ') || null
  }
  if (ev.surface === 'scsiwyg') {
    const parts: string[] = []
    if (e.blog)       parts.push(String(e.blog))
    if (e.visibility) parts.push(String(e.visibility))
    if (m.tag_count)  parts.push(`${m.tag_count} tags`)
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

// ─── Micro-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] ?? 'bg-stone-100 text-stone-600 border border-stone-200'
  return (
    <Tooltip label={status}>
      <span className={clsx('text-xs px-2 py-0.5 font-medium cursor-default', cls)}>
        {status.replace(/-/g, ' ')}
      </span>
    </Tooltip>
  )
}

function SurfacePill({ surface, count, showCount = true }: { surface: string; count?: number; showCount?: boolean }) {
  const s = SURFACE_STYLE[surface] ?? { label: surface, pill: 'bg-stone-100 text-stone-600 border border-stone-200', dot: 'bg-stone-400', hex: '#78716c' }
  return (
    <Tooltip label={`${s.label}${count !== undefined ? ` · ${count} events` : ''}`}>
      <span className={clsx('inline-flex items-center gap-1 text-xs px-1.5 py-0.5 font-mono cursor-default', s.pill)}>
        <span className={clsx('w-1.5 h-1.5', s.dot)} />
        {surface.slice(0, 2).toUpperCase()}
        {showCount && count !== undefined && <span className="opacity-60 ml-0.5">{count}</span>}
      </span>
    </Tooltip>
  )
}

function TypeBar({ type, count, max }: { type: string; count: number; max: number }) {
  const color = TYPE_BAR_COLOR[type] ?? 'bg-stone-300'
  return (
    <Tooltip label={`${type}: ${count} events`}>
      <div className="flex items-center gap-1.5 cursor-default">
        <span className="text-xs text-stone-400 w-14 shrink-0 truncate">{type}</span>
        <div className="flex-1 bg-stone-100 h-1.5 overflow-hidden">
          <div className={clsx('h-full transition-all', color)} style={{ width: `${(count / max) * 100}%` }} />
        </div>
        <span className="text-xs text-stone-500 w-5 text-right tabular-nums shrink-0">{count}</span>
      </div>
    </Tooltip>
  )
}

function Sparkline({ data }: { data: SparkPoint[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-px h-7">
      {data.map(({ date, count }) => (
        <Tooltip key={date} label={`${date}: ${count} event${count !== 1 ? 's' : ''}`}>
          <div
            style={{ height: count > 0 ? `${Math.max((count / max) * 100, 14)}%` : '10%' }}
            className={clsx(
              'flex-1 transition-all duration-200 cursor-default',
              count > 0 ? 'bg-amber-400/70 hover:bg-amber-500' : 'bg-stone-200'
            )}
          />
        </Tooltip>
      ))}
    </div>
  )
}

// ─── Column summary card ──────────────────────────────────────────────────────

function ColumnSummaryCard({
  projects, activeSurfaces, activeTypes,
}: {
  projects: Project[]
  activeSurfaces: Set<string>
  activeTypes: Set<string>
}) {
  const totalEvents = projects.reduce((sum, p) =>
    sum + Object.entries(p.events_by_type)
      .filter(([t]) => activeTypes.has(t))
      .reduce((s, [, c]) => s + c, 0)
  , 0)

  const activeCount = projects.filter(p => p.events_recent > 0).length

  const bySurface: Record<string, number> = {}
  for (const p of projects) {
    for (const [s, c] of Object.entries(p.events_by_surface)) {
      if (activeSurfaces.has(s)) bySurface[s] = (bySurface[s] || 0) + c
    }
  }
  const surfaceTotal = Object.values(bySurface).reduce((s, c) => s + c, 0)
  const topSurface   = Object.entries(bySurface).sort((a, b) => b[1] - a[1])[0]

  const lastActive = projects
    .filter(p => p.last_activity)
    .sort((a, b) => new Date(b.last_activity!).getTime() - new Date(a.last_activity!).getTime())[0]

  return (
    <div className="bg-stone-100 border border-stone-300 p-3 mb-3 space-y-2 shrink-0">
      {/* totals row */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-stone-700 tabular-nums">
          {totalEvents > 0 ? totalEvents.toLocaleString() : '0'} events
        </span>
        <span className="text-xs text-stone-400">
          {activeCount}/{projects.length} active
        </span>
      </div>

      {/* surface proportion bar */}
      {surfaceTotal > 0 && (
        <div className="flex h-2 gap-px overflow-hidden">
          {Object.entries(bySurface)
            .filter(([, c]) => c > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => {
              const meta = SURFACE_STYLE[s]
              return (
                <Tooltip key={s} label={`${meta?.label ?? s}: ${c}`}>
                  <div
                    style={{ flex: c }}
                    className={clsx('h-full cursor-default', meta?.dot ?? 'bg-stone-400')}
                  />
                </Tooltip>
              )
            })}
        </div>
      )}

      {/* bottom row: top surface + last activity */}
      <div className="flex items-center justify-between gap-2 text-xs text-stone-400">
        {topSurface ? (
          <span>{SURFACE_STYLE[topSurface[0]]?.label ?? topSurface[0]} leads</span>
        ) : (
          <span>No activity</span>
        )}
        {lastActive?.last_activity && (
          <span>{timeAgo(lastActive.last_activity)}</span>
        )}
      </div>
    </div>
  )
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, activeSurfaces, activeTypes, onNib, onRemoveRepo,
}: {
  project: Project
  activeSurfaces: Set<string>
  activeTypes: Set<string>
  onNib: (p: Project) => void
  onRemoveRepo?: (projectId: string, repo: string) => void
}) {
  const visibleSurfaces = Object.entries(project.events_by_surface)
    .filter(([s]) => activeSurfaces.has(s))
    .sort((a, b) => b[1] - a[1])

  const typeEntries = Object.entries(project.events_by_type)
    .filter(([t]) => activeTypes.has(t))
    .sort((a, b) => b[1] - a[1])

  const visibleCount = typeEntries.reduce((s, [, c]) => s + c, 0)
  const typeMax      = Math.max(...typeEntries.map(([, c]) => c), 1)
  const firstAlias   = project.aliases?.[0]

  return (
    <div className="bg-white border border-stone-200 shadow-sm hover:shadow-md hover:border-stone-300 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-stone-800 leading-tight">{project.id}</h3>
            <Tooltip label={`Priority ${project.priority}`}>
              <span className="text-xs bg-stone-100 text-stone-500 border border-stone-200 px-1.5 py-px font-mono cursor-default">
                P{project.priority}
              </span>
            </Tooltip>
            {project.is_code_only && (
              <Tooltip label="GitHub activity only — no email, Slack, or Docs in this period">
                <span className="text-xs bg-amber-50 text-amber-700 border border-amber-300 px-1.5 py-px font-medium cursor-default">
                  code only
                </span>
              </Tooltip>
            )}
          </div>
          {firstAlias && firstAlias !== project.id && (
            <p className="text-xs text-stone-400 mt-0.5 truncate">{firstAlias}</p>
          )}
          <div className="mt-1.5">
            <StatusBadge status={project.status} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <Tooltip label={`${visibleCount} events in selected period`}>
            <div className="text-2xl font-bold text-stone-700 leading-none tabular-nums cursor-default">{visibleCount}</div>
          </Tooltip>
          <div className="text-xs text-stone-400 mt-0.5">this period</div>
        </div>
      </div>

      {/* Sparkline */}
      <div className="px-3 pb-2">
        <Sparkline data={project.sparkline} />
      </div>

      {/* Type breakdown */}
      {typeEntries.length > 0 && (
        <div className="px-3 pb-2.5 space-y-1 border-t border-stone-100 pt-2">
          {typeEntries.map(([type, count]) => (
            <TypeBar key={type} type={type} count={count} max={typeMax} />
          ))}
        </div>
      )}

      {/* Surface pills */}
      {visibleSurfaces.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2.5 border-t border-stone-100 pt-2">
          {visibleSurfaces.map(([s, c]) => (
            <SurfacePill key={s} surface={s} count={c} />
          ))}
        </div>
      )}

      {/* GitHub repos */}
      {project.repos?.length > 0 && (
        <div className="px-3 pb-2.5 border-t border-stone-100 pt-2 space-y-1">
          {project.repos.map(r => (
            <div key={r.name} className="flex items-center gap-1 group/repo">
              <Tooltip label={`${r.commits} commit${r.commits !== 1 ? 's' : ''}${r.last_commit ? ' · last: ' + timeAgo(r.last_commit) : ''}`}>
                <div className="flex items-center justify-between gap-2 cursor-default flex-1 min-w-0">
                  <span className="text-xs text-stone-500 font-mono truncate">{r.name}</span>
                  <span className="text-xs text-stone-400 tabular-nums shrink-0">{r.commits}c</span>
                </div>
              </Tooltip>
              {onRemoveRepo && (
                <button
                  onClick={e => { e.stopPropagation(); onRemoveRepo(project.id, r.name) }}
                  className="shrink-0 w-4 h-4 flex items-center justify-center text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover/repo:opacity-100"
                  title={`Remove ${r.name} from ${project.id}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Themes */}
      {project.themes.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2.5 border-t border-stone-100 pt-2">
          {project.themes.slice(0, 3).map(t => (
            <Tooltip key={t} label={t}>
              <span className="text-xs bg-stone-50 text-stone-500 border border-stone-200 px-1.5 py-px cursor-default truncate max-w-[110px]">
                #{t}
              </span>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Last activity + nib trigger */}
      <div className="px-3 pb-3 border-t border-stone-100 pt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          {project.last_event && project.last_activity ? (
            <>
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <span className="text-stone-500 font-medium">{timeAgo(project.last_activity)}</span>
                <span className="text-stone-300">·</span>
                <SurfacePill surface={project.last_event.surface} showCount={false} />
              </div>
              <p className="text-xs text-stone-500 leading-tight line-clamp-2">
                {project.last_event.excerpt}
              </p>
            </>
          ) : (
            <p className="text-xs text-stone-300">No recent activity</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {project.events_total > 0 && (
            <Tooltip label={`${project.events_total.toLocaleString()} total all-time events`}>
              <span className="text-xs text-stone-400 tabular-nums cursor-default">
                {project.events_total.toLocaleString()} all-time
              </span>
            </Tooltip>
          )}
          <button
            onClick={() => onNib(project)}
            className="text-xs bg-stone-50 hover:bg-amber-50 text-stone-500 hover:text-amber-700 border border-stone-200 hover:border-amber-300 px-2 py-0.5 transition-colors font-medium"
          >
            Detail →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Kanban column ────────────────────────────────────────────────────────────

// ─── Draggable + droppable project card wrapper ───────────────────────────────

function DraggableProjectCard({
  project, activeSurfaces, activeTypes, onNib, onRemoveRepo, isDragging, isRepoDragActive,
}: {
  project: Project
  activeSurfaces: Set<string>
  activeTypes: Set<string>
  onNib: (p: Project) => void
  onRemoveRepo?: (projectId: string, repo: string) => void
  isDragging?: boolean
  isRepoDragActive?: boolean
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: `project::${project.id}`,
    data: { type: 'project', project },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `project-drop::${project.id}`,
    data: { type: 'project-drop', project },
  })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  // Merge the two refs
  function setRef(el: HTMLDivElement | null) {
    setDragRef(el)
    setDropRef(el)
  }

  return (
    <div
      ref={setRef}
      style={style}
      {...attributes}
      className={clsx(
        'touch-none mb-3',
        isDragging && 'opacity-40',
        isRepoDragActive && isOver && 'ring-2 ring-emerald-400 ring-inset',
        isRepoDragActive && !isOver && 'opacity-60',
      )}
    >
      {/* Drag handle strip */}
      <div
        {...listeners}
        className="h-4 bg-stone-100 border-b border-stone-200 flex items-center justify-center cursor-grab active:cursor-grabbing group"
        title="Drag to move to another portfolio"
      >
        <span className="text-[8px] text-stone-300 group-hover:text-stone-400 tracking-widest select-none">⠿⠿⠿</span>
      </div>
      {/* Repo-drop overlay label */}
      {isRepoDragActive && isOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="bg-emerald-600 text-white text-xs font-semibold px-2 py-1 shadow">Add repo to project</span>
        </div>
      )}
      <ProjectCard
        project={project}
        activeSurfaces={activeSurfaces}
        activeTypes={activeTypes}
        onNib={onNib}
        onRemoveRepo={onRemoveRepo}
      />
    </div>
  )
}

// ─── Explicit "create project" drop zone at the top of each column ───────────

function CreateProjectDropZone({ columnId }: { columnId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `create-project::${columnId}`,
    data: { type: 'create-project', columnId },
  })
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'mb-2 shrink-0 border-2 border-dashed flex items-center justify-center h-10 text-xs font-medium transition-all duration-150 select-none',
        isOver
          ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
          : 'border-stone-300 bg-stone-50/60 text-stone-400',
      )}
    >
      {isOver ? '+ drop to create project' : '+ new project from repo'}
    </div>
  )
}

// ─── Sortable + droppable kanban column ───────────────────────────────────────

function KanbanColumn({
  id, title, subtitle, projects, colBorder, colBg, heading,
  activeSurfaces, activeTypes, onNib, onRemoveRepo, activeId, isRepoDragActive,
}: {
  id: string
  title: string
  subtitle?: string
  projects: Project[]
  colBorder: string
  colBg: string
  heading: string
  activeSurfaces: Set<string>
  activeTypes: Set<string>
  onNib: (p: Project) => void
  onRemoveRepo: (projectId: string, repo: string) => void
  activeId: string | null
  isRepoDragActive: boolean
}) {
  // Sortable (for column reorder)
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isColDragging,
  } = useSortable({ id: `col::${id}`, data: { type: 'column', columnId: id } })

  // Also a drop zone for cards / repos
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `portfolio::${id}` })

  function setRef(el: HTMLDivElement | null) {
    setSortableRef(el)
    setDropRef(el)
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setRef}
      style={style}
      className={clsx(
        'flex flex-col w-0 flex-1 min-w-0 border p-3 transition-colors duration-150 overflow-hidden',
        colBorder, colBg,
        isOver && !isRepoDragActive && 'ring-2 ring-inset ring-stone-400/60 brightness-95',
        isColDragging && 'opacity-50 z-50',
      )}
    >
      {/* Column header — grip on the left */}
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <div
          {...attributes}
          {...listeners}
          className="h-5 w-4 flex items-center justify-center cursor-grab active:cursor-grabbing shrink-0 group"
          title="Drag to reorder column"
        >
          <span className="text-[8px] text-stone-300 group-hover:text-stone-500 leading-none select-none rotate-90">⠿⠿⠿</span>
        </div>
        <div className="flex-1 flex items-baseline justify-between gap-1 min-w-0">
          <div className="min-w-0">
            <h2 className={clsx('font-bold text-xs uppercase tracking-widest truncate', heading)}>{title}</h2>
            {subtitle && <p className="text-xs text-stone-400 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <Tooltip label={`${projects.length} project${projects.length !== 1 ? 's' : ''}`}>
            <span className="text-xs bg-white/70 text-stone-500 border border-stone-200 px-2 py-0.5 tabular-nums cursor-default shrink-0">
              {projects.length}
            </span>
          </Tooltip>
        </div>
      </div>

      {/* Dynamic summary */}
      <ColumnSummaryCard
        projects={projects}
        activeSurfaces={activeSurfaces}
        activeTypes={activeTypes}
      />

      {/* Repo drop zone — create new project (visible only while dragging a repo) */}
      {isRepoDragActive && (
        <CreateProjectDropZone columnId={id} />
      )}

      {/* Project cards */}
      <div className="overflow-y-auto flex-1 overflow-x-hidden">
        {projects.map(p => (
          <DraggableProjectCard
            key={p.id}
            project={p}
            activeSurfaces={activeSurfaces}
            activeTypes={activeTypes}
            onNib={onNib}
            onRemoveRepo={onRemoveRepo}
            isDragging={activeId === `project::${p.id}`}
            isRepoDragActive={isRepoDragActive}
          />
        ))}
        {projects.length === 0 && (
          <div className={clsx(
            'text-xs text-center py-12 transition-colors',
            isOver && !isRepoDragActive ? 'text-stone-500' : 'text-stone-300'
          )}>
            {isOver && !isRepoDragActive ? 'Drop here' : 'No projects'}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Nib detail panel ─────────────────────────────────────────────────────────

function NibPanel({ project, days, onClose }: { project: Project; days: number; onClose: () => void }) {
  const [events, setEvents]   = useState<WorkEvent[]>([])
  const [loading, setLoading] = useState(true)
  const panelRef              = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/events?project=${project.id}&days=${days}&limit=60`)
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .finally(() => setLoading(false))
  }, [project.id, days])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeEntries    = Object.entries(project.events_by_type).sort((a, b) => b[1] - a[1])
  const surfaceEntries = Object.entries(project.events_by_surface).sort((a, b) => b[1] - a[1])
  const typeMax        = Math.max(...typeEntries.map(([, c]) => c), 1)
  const surfaceMax     = Math.max(...surfaceEntries.map(([, c]) => c), 1)

  return (
    <>
      <div className="fixed inset-0 bg-stone-900/10 z-40" onClick={onClose} />
      <div ref={panelRef} className="fixed right-0 top-0 h-full w-[420px] bg-white border-l border-stone-200 shadow-2xl z-50 flex flex-col">
        {/* Panel header */}
        <div className="px-5 py-4 border-b border-stone-100 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-stone-900 truncate">{project.id}</h2>
              {project.aliases?.length > 0 && (
                <p className="text-xs text-stone-400 mt-0.5 truncate">{project.aliases.join(' · ')}</p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <StatusBadge status={project.status} />
                <span className="text-xs bg-stone-100 text-stone-500 border border-stone-200 px-2 py-0.5 font-medium">
                  {project.portfolio}
                </span>
                <Tooltip label={`Priority ${project.priority}`}>
                  <span className="text-xs bg-stone-100 text-stone-500 border border-stone-200 px-1.5 py-0.5 font-mono cursor-default">
                    P{project.priority}
                  </span>
                </Tooltip>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1">
              <Link
                href={`/project/${project.id}`}
                className="text-xs text-stone-400 hover:text-amber-700 hover:bg-amber-50 border border-stone-200 hover:border-amber-300 px-2 py-1 transition-colors font-medium"
                onClick={onClose}
              >
                Full detail ↗
              </Link>
              <button
                onClick={onClose}
                className="text-stone-400 hover:text-stone-700 hover:bg-stone-100 w-7 h-7 flex items-center justify-center transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Stats */}
          <div className="px-5 py-4 border-b border-stone-100">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-stone-50 border border-stone-200 p-3">
                <div className="text-2xl font-bold text-stone-800 tabular-nums">{project.events_total.toLocaleString()}</div>
                <div className="text-xs text-stone-500 mt-0.5">all-time events</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 p-3">
                <div className="text-2xl font-bold text-amber-700 tabular-nums">{project.events_recent}</div>
                <div className="text-xs text-stone-500 mt-0.5">this period</div>
              </div>
            </div>
          </div>

          {/* Sparkline enlarged */}
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">14-day activity</h3>
            <div className="flex items-end gap-px h-14">
              {project.sparkline.map(({ date, count }) => {
                const max = Math.max(...project.sparkline.map(d => d.count), 1)
                return (
                  <Tooltip key={date} label={`${date}: ${count}`}>
                    <div
                      style={{ height: count > 0 ? `${Math.max((count / max) * 100, 10)}%` : '6%' }}
                      className={clsx('flex-1 cursor-default transition-all', count > 0 ? 'bg-amber-400/70 hover:bg-amber-500' : 'bg-stone-100')}
                    />
                  </Tooltip>
                )
              })}
            </div>
          </div>

          {/* Surface breakdown */}
          {surfaceEntries.length > 0 && (
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2.5">By surface</h3>
              <div className="space-y-2">
                {surfaceEntries.map(([s, c]) => {
                  const meta = SURFACE_STYLE[s] ?? { label: s, dot: 'bg-stone-400', pill: '', hex: '#78716c' }
                  return (
                    <div key={s} className="flex items-center gap-2">
                      <span className="text-xs text-stone-500 w-14 shrink-0 flex items-center gap-1">
                        <span className={clsx('w-1.5 h-1.5 shrink-0', meta.dot)} />
                        {meta.label}
                      </span>
                      <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
                        <div className={clsx('h-full', meta.dot)} style={{ width: `${(c / surfaceMax) * 100}%` }} />
                      </div>
                      <span className="text-xs text-stone-500 w-6 text-right tabular-nums">{c}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Type breakdown */}
          {typeEntries.length > 0 && (
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2.5">By type</h3>
              <div className="space-y-2">
                {typeEntries.map(([type, count]) => {
                  const color = TYPE_BAR_COLOR[type] ?? 'bg-stone-300'
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <span className="text-xs text-stone-500 w-14 shrink-0">{type}</span>
                      <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
                        <div className={clsx('h-full', color)} style={{ width: `${(count / typeMax) * 100}%` }} />
                      </div>
                      <span className="text-xs text-stone-500 w-6 text-right tabular-nums">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Event list */}
          <div className="px-5 py-4">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              Recent events {events.length > 0 && <span className="normal-case text-stone-300">({events.length})</span>}
            </h3>
            {loading && <div className="text-xs text-stone-400 animate-pulse py-4 text-center">Loading events…</div>}
            {!loading && events.length === 0 && <div className="text-xs text-stone-300 py-4 text-center">No events in this period</div>}
            {!loading && events.length > 0 && (
              <div className="space-y-2.5">
                {events.map(ev => {
                  const excerpt = getEventExcerpt(ev)
                  const meta    = getEventMeta(ev)
                  const sStyle  = SURFACE_STYLE[ev.surface] ?? { label: ev.surface, pill: 'bg-stone-100 text-stone-600 border border-stone-200', dot: 'bg-stone-400', hex: '#78716c' }
                  const tColor  = TYPE_BAR_COLOR[ev.type] ?? 'bg-stone-300'
                  return (
                    <div key={ev.id} className="bg-stone-50 border border-stone-100 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-stone-400 tabular-nums">{formatEventTime(ev.timestamp)}</span>
                        <span className={clsx('inline-flex items-center gap-1 text-xs px-1.5 py-px font-mono', sStyle.pill)}>
                          <span className={clsx('w-1.5 h-1.5', sStyle.dot)} />
                          {sStyle.label}
                        </span>
                        <span className={clsx('text-xs px-1.5 py-px text-white font-medium', tColor)}>
                          {ev.type}
                        </span>
                      </div>
                      <p className="text-xs text-stone-700 leading-snug">{excerpt}</p>
                      {meta && <p className="text-xs text-stone-400 leading-tight">{meta}</p>}
                      {ev.themes?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {ev.themes.map(t => (
                            <span key={t} className="text-xs text-stone-400 bg-white border border-stone-100 px-1.5 py-px">#{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Untracked repos column ───────────────────────────────────────────────────

function DraggableRepoCard({ repo }: { repo: UntrackedRepo }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `repo::${repo.name}`,
    data: { type: 'repo', repo },
  })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="touch-none">
      <div
        {...listeners}
        className="h-4 bg-stone-100 border-b border-stone-200 flex items-center justify-center cursor-grab active:cursor-grabbing group"
        title="Drag to assign to a portfolio"
      >
        <span className="text-[8px] text-stone-300 group-hover:text-stone-400 tracking-widest select-none">⠿⠿⠿</span>
      </div>
      <div className="bg-white border border-stone-200 p-3 space-y-1.5 hover:border-stone-300 transition-colors border-t-0">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-mono text-stone-700 font-semibold break-all leading-tight">{repo.name}</span>
          <Tooltip label={`${repo.commits} commit${repo.commits !== 1 ? 's' : ''} in period`}>
            <div className="shrink-0 text-right cursor-default">
              <span className="text-lg font-bold text-stone-600 tabular-nums leading-none">{repo.commits}</span>
              <span className="text-xs text-stone-400 block">commits</span>
            </div>
          </Tooltip>
        </div>
        {repo.last_commit && (
          <p className="text-xs text-stone-400">Last commit {timeAgo(repo.last_commit)}</p>
        )}
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-stone-400" />
          <span className="text-xs text-stone-400">github · build</span>
        </div>
      </div>
    </div>
  )
}

function UntrackedReposColumn({ repos }: { repos: UntrackedRepo[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'portfolio::untracked' })
  if (repos.length === 0) return null
  return (
    <div ref={setNodeRef} className={clsx('flex flex-col flex-1 min-w-0 border border-dashed border-stone-300 bg-stone-50/60 p-3 transition-colors', isOver && 'bg-stone-100/80')}>
      <div className="flex items-baseline justify-between mb-2 shrink-0">
        <div>
          <h2 className="font-bold text-xs uppercase tracking-widest text-stone-400">Untracked Repos</h2>
          <p className="text-xs text-stone-400 mt-0.5">GitHub activity · no project</p>
        </div>
        <Tooltip label={`${repos.length} repos with unattributed commits`}>
          <span className="text-xs bg-white text-stone-400 border border-stone-200 px-2 py-0.5 tabular-nums cursor-default">
            {repos.length}
          </span>
        </Tooltip>
      </div>

      {/* Summary bar */}
      <div className="bg-stone-100 border border-stone-200 p-3 mb-3 space-y-1 shrink-0">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-stone-600 tabular-nums">
            {repos.reduce((s, r) => s + r.commits, 0)} commits
          </span>
          <span className="text-xs text-stone-400">unattributed</span>
        </div>
        <p className="text-xs text-stone-400">
          These repos have GitHub activity but no matching project in manifest.yaml
        </p>
      </div>

      <div className="space-y-2 overflow-y-auto flex-1">
        {repos.map(r => (
          <DraggableRepoCard key={r.name} repo={r} />
        ))}
      </div>
    </div>
  )
}

// ─── Sidebar section ──────────────────────────────────────────────────────────

// ─── Repo → Project modal ─────────────────────────────────────────────────────

function RepoToProjectModal({
  repo, portfolio, portfolios, onConfirm, onCancel,
}: {
  repo: UntrackedRepo
  portfolio: string
  portfolios: string[]
  onConfirm: (projectId: string, name: string, portfolio: string) => void
  onCancel: () => void
}) {
  const defaultId   = repo.name.split('/').pop()?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? ''
  const [pid, setPid]         = useState(defaultId)
  const [name, setName]       = useState(defaultId)
  const [port, setPort]       = useState(portfolio)
  const [saving, setSaving]   = useState(false)

  function submit() {
    if (!pid.trim()) return
    setSaving(true)
    onConfirm(pid.trim(), name.trim() || pid.trim(), port)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white border border-stone-200 shadow-2xl w-96 p-6 space-y-4">
        <div>
          <h2 className="font-bold text-stone-800 text-sm mb-0.5">Create project from repo</h2>
          <p className="text-xs text-stone-400 font-mono break-all">{repo.name}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Project ID</label>
            <input
              className="w-full border border-stone-300 px-2 py-1.5 text-sm font-mono text-stone-800 focus:outline-none focus:border-stone-500"
              value={pid}
              onChange={e => setPid(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-project"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Display name</label>
            <input
              className="w-full border border-stone-300 px-2 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-stone-500"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Portfolio</label>
            <select
              className="w-full border border-stone-300 px-2 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-stone-500 bg-white"
              value={port}
              onChange={e => setPort(e.target.value)}
            >
              {portfolios.map(p => (
                <option key={p} value={p}>{PORTFOLIO_META[p]?.label ?? p}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={submit}
            disabled={!pid.trim() || saving}
            className="flex-1 bg-stone-800 text-white text-sm py-2 font-medium hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Creating…' : 'Create project'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 text-sm text-stone-500 border border-stone-300 hover:border-stone-400 transition-colors"
          >
            Cancel
          </button>
        </div>

        <p className="text-xs text-stone-400">
          Adds a new project stub to <span className="font-mono">manifest.yaml</span> and binds {repo.name} as its GitHub repo.
        </p>
      </div>
    </div>
  )
}

// ─── Add repo to existing project modal ──────────────────────────────────────

function AddRepoModal({
  repo, project, onConfirm, onCancel,
}: {
  repo: UntrackedRepo
  project: Project
  onConfirm: () => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)

  function submit() {
    setSaving(true)
    fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addRepo: repo.name }),
    }).then(r => r.json()).then(result => {
      if (result.ok) onConfirm()
      else { setSaving(false); console.error('[add-repo]', result.error) }
    }).catch(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white border border-stone-200 shadow-2xl w-96 p-6 space-y-4">
        <div>
          <h2 className="font-bold text-stone-800 text-sm mb-0.5">Add repo to project</h2>
          <p className="text-xs text-stone-400">This will bind the repo to the project in <span className="font-mono">manifest.yaml</span>.</p>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 px-3 py-2">
            <span className="text-stone-400 shrink-0">Repo</span>
            <span className="font-mono text-stone-700 break-all">{repo.name}</span>
          </div>
          <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 px-3 py-2">
            <span className="text-stone-400 shrink-0">Project</span>
            <span className="font-mono text-stone-700">{project.id}</span>
            <span className="text-stone-300 ml-auto">{project.portfolio}</span>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 bg-stone-800 text-white text-sm py-2 font-medium hover:bg-stone-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Add repo to project'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 text-sm text-stone-500 border border-stone-300 hover:border-stone-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar section ──────────────────────────────────────────────────────────

function PortfolioGroup({ portfolio, meta, projects, hiddenPortfolios, togglePortfolio, hiddenProjects, toggleProject }: {
  portfolio: string
  meta: { label: string; dot: string }
  projects: Project[]
  hiddenPortfolios: Set<string>
  togglePortfolio: (id: string) => void
  hiddenProjects: Set<string>
  toggleProject: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  const portfolioHidden = hiddenPortfolios.has(portfolio)
  return (
    <div>
      <div className="flex items-center gap-0.5 mb-0.5 px-2 group/port">
        {/* Toggle entire portfolio */}
        <button
          onClick={() => togglePortfolio(portfolio)}
          className="flex items-center gap-1 flex-1 text-left"
          title={portfolioHidden ? `Show ${meta.label}` : `Hide ${meta.label}`}
        >
          <span className={clsx('w-1.5 h-1.5 shrink-0 transition-opacity', meta.dot, portfolioHidden && 'opacity-25')} />
          <span className={clsx('text-xs font-semibold transition-colors',
            portfolioHidden ? 'text-stone-300 line-through' : 'text-stone-400 group-hover/port:text-stone-600'
          )}>
            {meta.label}
          </span>
        </button>
        {/* Collapse/expand project list */}
        <button
          onClick={() => setOpen(o => !o)}
          className="text-stone-300 hover:text-stone-500 text-[9px] transition-transform duration-150 px-0.5"
          title={open ? 'Collapse' : 'Expand'}
        >
          <span className={clsx('inline-block transition-transform duration-150', open ? 'rotate-0' : '-rotate-90')}>▾</span>
        </button>
      </div>
      {open && !portfolioHidden && projects.map(p => {
        const hidden = hiddenProjects.has(p.id)
        return (
          <button key={p.id} onClick={() => toggleProject(p.id)}
            className={clsx('w-full text-left text-xs px-2 py-1 transition-colors flex items-center gap-1.5',
              hidden ? 'text-stone-300 line-through hover:text-stone-500' : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/40'
            )}
          >
            <span className={clsx('w-1 h-1 shrink-0', hidden ? 'bg-stone-300' : meta.dot)} />
            <span className="truncate">{p.id}</span>
          </button>
        )
      })}
    </div>
  )
}

function SidebarSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 w-full text-left mb-1.5 group"
      >
        <span className="text-xs font-bold text-stone-400 uppercase tracking-widest flex-1">{title}</span>
        <span className={clsx('text-stone-300 group-hover:text-stone-400 transition-transform duration-150 text-[10px]', open ? 'rotate-0' : '-rotate-90')}>▾</span>
      </button>
      {open && children}
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function WorkKanbanApp() {
  const [data, setData]                   = useState<ApiResponse | null>(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [days, setDays]                   = useState(120)
  const [activeSurfaces, setSurfaces]     = useState<Set<string>>(new Set(ALL_SURFACES))
  const [activeTypes, setTypes]           = useState<Set<string>>(new Set(ALL_TYPES))
  const [groupBy, setGroupBy]             = useState<GroupBy>('portfolio')
  const [lastRefresh, setLastRefresh]     = useState<Date | null>(null)
  const [nibProject, setNibProject]       = useState<Project | null>(null)
  const [hiddenProjects, setHiddenProjects]   = useState<Set<string>>(new Set())
  const [hiddenPortfolios, setHiddenPortfolios] = useState<Set<string>>(new Set())
  const [focusFilter, setFocusFilter]         = useState<FocusFilter>('all')

  // ── Drag-and-drop state ──────────────────────────────────────────────────
  const [activeId, setActiveId]           = useState<string | null>(null)
  const [repoModal, setRepoModal]         = useState<{ repo: UntrackedRepo; portfolio: string } | null>(null)
  const [addRepoModal, setAddRepoModal]   = useState<{ repo: UntrackedRepo; project: Project } | null>(null)

  // Column order — persisted to localStorage
  const [columnOrder, setColumnOrder]     = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('work-kanban-column-order')
        if (saved) return JSON.parse(saved)
      } catch {}
    }
    return []
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const isRepoDragActive = activeId?.startsWith('repo::') ?? false

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?days=${days}`)
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])
  useEffect(() => {
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  function toggleSurface(s: string) {
    setSurfaces(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })
  }
  function toggleType(t: string) {
    setTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })
  }
  function toggleProject(id: string) {
    setHiddenProjects(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function togglePortfolio(id: string) {
    setHiddenPortfolios(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRemoveRepo(projectId: string, repo: string) {
    // Optimistic: remove from project's repo list in local data
    setData(prev => prev ? {
      ...prev,
      projects: prev.projects.map(p =>
        p.id === projectId
          ? { ...p, repos: p.repos.filter(r => r.name !== repo) }
          : p
      ),
    } : prev)

    fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeRepo: repo }),
    }).then(r => r.json()).then(result => {
      if (result.ok) fetchData()   // re-fetch so repo reappears in untracked
      else {
        console.error('[remove-repo] failed:', result.error)
        fetchData()  // rollback via re-fetch
      }
    }).catch(() => fetchData())
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || !data) return

    const activeStr = String(active.id)
    const overStr   = String(over.id)
    const dragType  = (active.data.current as { type?: string })?.type

    // ── Column reorder ────────────────────────────────────────────────────
    if (dragType === 'column') {
      if (!overStr.startsWith('col::')) return
      const fromId = activeStr.replace('col::', '')
      const toId   = overStr.replace('col::', '')
      if (fromId === toId) return

      setColumnOrder(prev => {
        const order    = prev.length ? prev : columns.map(c => c.id)
        const fromIdx  = order.indexOf(fromId)
        const toIdx    = order.indexOf(toId)
        if (fromIdx === -1 || toIdx === -1) return prev
        const next = arrayMove(order, fromIdx, toIdx)
        try { localStorage.setItem('work-kanban-column-order', JSON.stringify(next)) } catch {}
        return next
      })
      return
    }

    // ── Project card → portfolio column ──────────────────────────────────
    if (activeStr.startsWith('project::') && overStr.startsWith('portfolio::')) {
      const projectId      = activeStr.replace('project::', '')
      const targetPortfolio = overStr.replace('portfolio::', '')
      const project        = data.projects.find(p => p.id === projectId)
      if (!project || project.portfolio === targetPortfolio || targetPortfolio === 'untracked') return

      setData(prev => prev ? {
        ...prev,
        projects: prev.projects.map(p => p.id === projectId ? { ...p, portfolio: targetPortfolio } : p),
      } : prev)

      fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: targetPortfolio }),
      }).then(r => r.json()).then(result => {
        if (!result.ok) {
          setData(prev => prev ? {
            ...prev,
            projects: prev.projects.map(p => p.id === projectId ? { ...p, portfolio: project.portfolio } : p),
          } : prev)
          console.error('[drag] move-portfolio failed:', result.error)
        }
      }).catch(() => {
        setData(prev => prev ? {
          ...prev,
          projects: prev.projects.map(p => p.id === projectId ? { ...p, portfolio: project.portfolio } : p),
        } : prev)
      })
      return
    }

    // ── Untracked repo → existing project card ────────────────────────────
    if (activeStr.startsWith('repo::') && overStr.startsWith('project-drop::')) {
      const repoName  = activeStr.replace('repo::', '')
      const projectId = overStr.replace('project-drop::', '')
      const repo      = data.untracked_repos.find(r => r.name === repoName)
      const project   = data.projects.find(p => p.id === projectId)
      if (!repo || !project) return
      setAddRepoModal({ repo, project })
      return
    }

    // ── Untracked repo → create-project drop zone ────────────────────────
    if (activeStr.startsWith('repo::') && overStr.startsWith('create-project::')) {
      const repoName       = activeStr.replace('repo::', '')
      const targetPortfolio = overStr.replace('create-project::', '')
      const repo           = data.untracked_repos.find(r => r.name === repoName)
      if (!repo) return
      setRepoModal({ repo, portfolio: targetPortfolio })
      return
    }

    // ── Untracked repo → portfolio column body (create new project) ───────
    if (activeStr.startsWith('repo::') && overStr.startsWith('portfolio::')) {
      const repoName       = activeStr.replace('repo::', '')
      const targetPortfolio = overStr.replace('portfolio::', '')
      const repo           = data.untracked_repos.find(r => r.name === repoName)
      if (!repo || targetPortfolio === 'untracked') return
      setRepoModal({ repo, portfolio: targetPortfolio })
      return
    }
  }

  function buildColumns() {
    if (!data) return []
    const projects = data.projects
      .filter(p => p.events_recent > 0)
      .filter(p => !hiddenPortfolios.has(p.portfolio))
      .filter(p => !hiddenProjects.has(p.id))
      .filter(p =>
        focusFilter === 'code-only' ? p.is_code_only :
        focusFilter === 'has-comms' ? !p.is_code_only :
        true
      )

    if (groupBy === 'portfolio') {
      const order = data.portfolios?.length ? data.portfolios : ['worksona', 'atomic47', 'nutabu', 'personal']
      return order.map(portfolio => {
        const meta = PORTFOLIO_META[portfolio] ?? { label: portfolio, colBorder: 'border-stone-200', colBg: 'bg-stone-50/40', heading: 'text-stone-500', dot: 'bg-stone-400' }
        return {
          id: portfolio, title: meta.label, subtitle: undefined,
          colBorder: meta.colBorder, colBg: meta.colBg, heading: meta.heading,
          projects: projects.filter(p => p.portfolio === portfolio).sort((a, b) => a.priority - b.priority),
        }
      })
    }

    if (groupBy === 'status') {
      const statuses = [...new Set(projects.map(p => p.status))]
      return statuses.map(status => ({
        id: status, title: status.replace(/-/g, ' '), subtitle: undefined,
        colBorder: 'border-stone-200', colBg: 'bg-stone-50/40', heading: 'text-stone-600',
        projects: projects.filter(p => p.status === status).sort((a, b) => b.events_recent - a.events_recent),
      }))
    }

    if (groupBy === 'activity') {
      return [
        { id: 'hot',    title: 'Hot',    subtitle: '20+ events', colBorder: 'border-red-200',    colBg: 'bg-red-50/30',    heading: 'text-red-700',    projects: projects.filter(p => p.events_recent >= 20) },
        { id: 'warm',   title: 'Warm',   subtitle: '5–19 events', colBorder: 'border-orange-200', colBg: 'bg-orange-50/30', heading: 'text-orange-700', projects: projects.filter(p => p.events_recent >= 5 && p.events_recent < 20) },
        { id: 'cool',   title: 'Cool',   subtitle: '1–4 events', colBorder: 'border-sky-200',    colBg: 'bg-sky-50/30',    heading: 'text-sky-700',    projects: projects.filter(p => p.events_recent > 0 && p.events_recent < 5) },
        { id: 'silent', title: 'Silent', subtitle: 'No activity', colBorder: 'border-stone-200', colBg: 'bg-stone-50/30',  heading: 'text-stone-400',  projects: projects.filter(p => p.events_recent === 0) },
      ]
    }

    if (groupBy === 'timeline') {
      const now      = new Date()
      const todayStr = now.toISOString().split('T')[0]
      const yestStr  = new Date(now.getTime() - 86_400_000).toISOString().split('T')[0]
      const weekAgo  = now.getTime() - 7 * 86_400_000
      const isToday   = (p: Project) => !!p.last_activity?.startsWith(todayStr)
      const isYest    = (p: Project) => !!p.last_activity?.startsWith(yestStr)
      const isWeek    = (p: Project) => !isToday(p) && !isYest(p) && !!p.last_activity && new Date(p.last_activity).getTime() >= weekAgo
      const isEarlier = (p: Project) => !isToday(p) && !isYest(p) && !isWeek(p) && !!p.last_activity
      return [
        { id: 'today',     title: 'Today',     subtitle: todayStr, colBorder: 'border-amber-300/70', colBg: 'bg-amber-50/40', heading: 'text-amber-800', projects: projects.filter(isToday) },
        { id: 'yesterday', title: 'Yesterday', subtitle: yestStr,  colBorder: 'border-stone-300/60', colBg: 'bg-stone-50/40', heading: 'text-stone-700', projects: projects.filter(isYest) },
        { id: 'this-week', title: 'This Week', subtitle: '7 days', colBorder: 'border-stone-200',    colBg: 'bg-stone-50/30', heading: 'text-stone-600', projects: projects.filter(isWeek) },
        { id: 'earlier',   title: 'Earlier',   subtitle: undefined, colBorder: 'border-stone-200',   colBg: 'bg-stone-50/20', heading: 'text-stone-400', projects: projects.filter(isEarlier) },
      ]
    }

    return []
  }

  const rawColumns  = buildColumns().filter(col => col.projects.length > 0)
  const columns     = columnOrder.length
    ? [...rawColumns].sort((a, b) => {
        const ai = columnOrder.indexOf(a.id)
        const bi = columnOrder.indexOf(b.id)
        if (ai === -1 && bi === -1) return 0
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    : rawColumns

  // Group projects by portfolio for the sidebar list
  const projectsByPortfolio = data
    ? (data.portfolios?.length ? data.portfolios : ['worksona', 'atomic47', 'nutabu', 'aimqc', 'market-research', 'personal'])
        .map(portfolio => ({
          portfolio,
          meta: PORTFOLIO_META[portfolio] ?? { label: portfolio, colBorder: 'border-stone-200', colBg: 'bg-stone-50/40', heading: 'text-stone-600', dot: 'bg-stone-400' },
          projects: data.projects.filter(p => p.portfolio === portfolio && p.events_recent > 0).sort((a, b) => a.priority - b.priority),
        })).filter(g => g.projects.length > 0)
    : []

  return (
    <div className="flex h-full overflow-hidden" style={{ background: '#f5f0e8' }}>
      {/* ── Sidebar ── */}
      <aside className="w-44 border-r border-stone-200 flex flex-col gap-5 p-4 shrink-0 overflow-y-auto overflow-x-hidden" style={{ background: '#ede8df' }}>
        {/* Identity */}
        <div>
          <p className="text-xs text-stone-500 tabular-nums">
            {data ? `${data.state.events_total.toLocaleString()} total events` : '—'}
          </p>
        </div>

        <SidebarSection title="Range">
          <div className="flex flex-col gap-0.5">
            {DAY_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setDays(value)}
                className={clsx(
                  'text-left text-xs px-2 py-1 transition-colors',
                  days === value
                    ? 'bg-amber-700 text-white font-semibold'
                    : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/60'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Surface">
          <div className="flex flex-col gap-0.5">
            {ALL_SURFACES.map(s => {
              const meta = SURFACE_STYLE[s]
              const on   = activeSurfaces.has(s)
              return (
                <button key={s} onClick={() => toggleSurface(s)}
                  className={clsx('flex items-center gap-1.5 text-xs px-2 py-1 transition-colors text-left', on ? 'text-stone-700 bg-stone-200/60' : 'text-stone-400 hover:text-stone-600')}
                >
                  <span className={clsx('w-1.5 h-1.5 shrink-0 transition-opacity', meta?.dot, !on && 'opacity-30')} />
                  {s}
                </button>
              )
            })}
          </div>
        </SidebarSection>

        <SidebarSection title="Type">
          <div className="flex flex-col gap-0.5">
            {ALL_TYPES.map(t => {
              const on  = activeTypes.has(t)
              const bar = TYPE_BAR_COLOR[t] ?? 'bg-stone-300'
              return (
                <button key={t} onClick={() => toggleType(t)}
                  className={clsx('flex items-center gap-1.5 text-left text-xs px-2 py-1 transition-colors', on ? 'text-stone-700' : 'text-stone-400')}
                >
                  <span className={clsx('w-1.5 h-1.5 shrink-0 transition-opacity', bar, !on && 'opacity-25')} />
                  {t}
                </button>
              )
            })}
          </div>
        </SidebarSection>

        <SidebarSection title="Focus">
          <div className="flex flex-col gap-0.5">
            {([
              { id: 'all',       label: 'All projects' },
              { id: 'code-only', label: 'Code only' },
              { id: 'has-comms', label: 'Has comms' },
            ] as const).map(({ id, label }) => (
              <button key={id} onClick={() => setFocusFilter(id)}
                className={clsx('text-left text-xs px-2 py-1 transition-colors', focusFilter === id ? 'bg-amber-700 text-white font-semibold' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/60')}
              >
                {label}
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Group by">
          <div className="flex flex-col gap-0.5">
            {(['portfolio', 'status', 'activity', 'timeline'] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)}
                className={clsx('text-left text-xs px-2 py-1 transition-colors', groupBy === g ? 'bg-stone-300 text-stone-900 font-semibold' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/40')}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </SidebarSection>

        {/* Projects toggle list */}
        {projectsByPortfolio.length > 0 && (
          <SidebarSection title="Projects" defaultOpen={false}>
            <div className="flex flex-col gap-2">
              {projectsByPortfolio.map(({ portfolio, meta, projects }) => (
                <PortfolioGroup key={portfolio} portfolio={portfolio} meta={meta} projects={projects}
                  hiddenPortfolios={hiddenPortfolios} togglePortfolio={togglePortfolio}
                  hiddenProjects={hiddenProjects} toggleProject={toggleProject} />
              ))}
            </div>
          </SidebarSection>
        )}

        {/* Harvest status */}
        {data && (
          <div className="mt-auto pt-3 border-t border-stone-200">
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1.5">Harvests</h3>
            <div className="space-y-1">
              {ALL_SURFACES.map(s => {
                const meta     = SURFACE_STYLE[s]
                const t        = data.state.last_harvest_at[s]
                const evCount  = data.state.events_by_surface?.[s] ?? 0
                return (
                  <div key={s} className="flex items-center gap-1.5 text-xs">
                    <span className={clsx('w-1.5 h-1.5 shrink-0 rounded-full', meta?.dot ?? 'bg-stone-300')} />
                    <span className={clsx('flex-1 truncate', t ? 'text-stone-600' : 'text-stone-300')}>
                      {meta?.label ?? s}
                    </span>
                    {evCount > 0 && (
                      <span className="text-stone-400 tabular-nums">{evCount.toLocaleString()}</span>
                    )}
                    {t ? (
                      <Tooltip label={new Date(t).toLocaleString()}>
                        <span className="text-stone-300 cursor-default">{timeAgo(t)}</span>
                      </Tooltip>
                    ) : (
                      <span className="text-stone-200 italic">—</span>
                    )}
                  </div>
                )
              })}
            </div>
            {lastRefresh && (
              <p className="text-xs text-stone-300 mt-2">↺ {timeAgo(lastRefresh.toISOString())}</p>
            )}
          </div>
        )}
      </aside>

      {/* ── Board ── */}
      <main className="flex-1 overflow-hidden p-4">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-stone-400 animate-pulse">Loading work state…</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="bg-red-50 border border-red-200 p-5 max-w-md">
              <p className="text-sm text-red-600 font-semibold mb-1">Failed to load</p>
              <p className="text-xs text-red-400 font-mono break-all">{error}</p>
            </div>
          </div>
        )}
        {!loading && !error && (
          <DndContext
            sensors={sensors}
            collisionDetection={mixedCollisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={columns.map(c => `col::${c.id}`)}
              strategy={horizontalListSortingStrategy}
            >
            <div className="flex gap-3 h-full overflow-hidden">
              {columns.map(col => (
                <KanbanColumn
                  key={col.id}
                  id={col.id}
                  title={col.title}
                  subtitle={col.subtitle}
                  projects={col.projects}
                  colBorder={col.colBorder}
                  colBg={col.colBg}
                  heading={col.heading}
                  activeSurfaces={activeSurfaces}
                  activeTypes={activeTypes}
                  onNib={setNibProject}
                  onRemoveRepo={handleRemoveRepo}
                  activeId={activeId}
                  isRepoDragActive={isRepoDragActive}
                />
              ))}
              {(data?.untracked_repos?.length ?? 0) > 0 && (
                <UntrackedReposColumn repos={data!.untracked_repos} />
              )}
            </div>

            {/* Floating drag ghost */}
            <DragOverlay dropAnimation={null}>
              {activeId?.startsWith('col::') && (() => {
                const colId = activeId.replace('col::', '')
                const col   = columns.find(c => c.id === colId)
                return col ? (
                  <div className="border-2 border-stone-500 shadow-2xl opacity-90 w-48 h-32 p-3 rotate-1"
                    style={{ background: '#ede8df' }}>
                    <p className={clsx('font-bold text-xs uppercase tracking-widest', col.heading)}>{col.title}</p>
                    <p className="text-xs text-stone-400 mt-1">{col.projects.length} projects</p>
                  </div>
                ) : null
              })()}
              {activeId?.startsWith('project::') && (() => {
                const id = activeId.replace('project::', '')
                const p  = data?.projects.find(x => x.id === id)
                return p ? (
                  <div className="bg-white border-2 border-stone-400 shadow-2xl opacity-95 w-56 rotate-1">
                    <div className="h-4 bg-stone-200 border-b border-stone-300" />
                    <div className="px-3 py-2">
                      <p className="text-sm font-bold text-stone-800">{p.id}</p>
                      <p className="text-xs text-stone-400">{p.portfolio} → ?</p>
                    </div>
                  </div>
                ) : null
              })()}
              {activeId?.startsWith('repo::') && (() => {
                const name = activeId.replace('repo::', '')
                const r    = data?.untracked_repos.find(x => x.name === name)
                return r ? (
                  <div className="bg-white border-2 border-emerald-400 shadow-2xl opacity-95 w-48 rotate-1">
                    <div className="h-4 bg-emerald-100 border-b border-emerald-200" />
                    <div className="px-3 py-2">
                      <p className="text-xs font-mono font-bold text-stone-700 break-all">{r.name}</p>
                      <p className="text-xs text-stone-400">{r.commits} commits · drop on project or column</p>
                    </div>
                  </div>
                ) : null
              })()}
            </DragOverlay>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {/* ── Create-project modal (repo → portfolio) ── */}
      {repoModal && (
        <RepoToProjectModal
          repo={repoModal.repo}
          portfolio={repoModal.portfolio}
          portfolios={data?.portfolios ?? []}
          onConfirm={(projectId, name, portfolio) => {
            setRepoModal(null)
            fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, portfolio, repo: repoModal.repo.name }),
            }).then(r => r.json()).then(result => {
              if (result.ok) fetchData()
              else console.error('[create project]', result.error)
            })
          }}
          onCancel={() => setRepoModal(null)}
        />
      )}

      {/* ── Add-repo-to-project modal ── */}
      {addRepoModal && (
        <AddRepoModal
          repo={addRepoModal.repo}
          project={addRepoModal.project}
          onConfirm={() => { setAddRepoModal(null); fetchData() }}
          onCancel={() => setAddRepoModal(null)}
        />
      )}

      {/* ── Nib panel ── */}
      {nibProject && (
        <NibPanel project={nibProject} days={days} onClose={() => setNibProject(null)} />
      )}
    </div>
  )
}
