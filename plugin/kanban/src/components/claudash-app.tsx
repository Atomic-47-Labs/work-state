'use client'

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'

// ─── Constants ────────────────────────────────────────────────────────────────

const CC       = '#8b5cf6'
const CC_DIM   = '#a78bfa'
const CC_DARK  = '#5b21b6'
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SIZE_META: Record<string, { label: string; color: string; desc: string }> = {
  trivial:  { label: 'Trivial',  color: '#d6d3d1', desc: '<5 tools' },
  quick:    { label: 'Quick',    color: '#c4b5fd', desc: '<25 tools, <15 min' },
  focused:  { label: 'Focused',  color: '#8b5cf6', desc: '<100 tools, <60 min' },
  deep:     { label: 'Deep',     color: '#6d28d9', desc: '<250 tools, <3 hr' },
  marathon: { label: 'Marathon', color: '#2e1065', desc: '≥250 tools or ≥3 hr' },
}

const BURST_META: Record<string, { label: string; color: string }> = {
  compact:   { label: 'Compact',   color: '#c4b5fd' },
  intense:   { label: 'Intense',   color: CC },
  sustained: { label: 'Sustained', color: CC_DARK },
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#a8a29e', Edit: CC, Write: '#6d28d9', MultiEdit: '#7c3aed',
  Bash: '#d97706', Grep: '#0891b2', Glob: '#0e7490',
  Task: '#dc2626', WebFetch: '#059669', WebSearch: '#10b981',
}

const DAY_OPTIONS = [
  { label: '7d', value: '7' }, { label: '30d', value: '30' },
  { label: '60d', value: '60' }, { label: '90d', value: '90' },
  { label: 'All', value: 'all' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPoint {
  date: string; sessions: number; tools: number; bursts: number
  tool_mix: Record<string, number>; avg_agentic: number
}
interface WeeklyPoint { week: string; sessions: number; tools: number; bursts: number }
interface HeatmapPoint { date: string; sessions: number; tools: number }
interface ScatterPoint { duration_min: number; tool_calls: number; size_class: string; project: string; date: string; agentic_ratio: number; subagents: number }
interface ProjectRow { id: string; sessions: number; tools: number; bursts: number; last_active: string }
interface FileRow { path: string; count: number }
interface BranchRow { branch: string; sessions: number }
interface SnapShot { sessions: number; tools: number; bursts: number; projects: string[]; branches: string[] }

interface ClaudashData {
  empty?: boolean
  window: { days: number | 'all'; start: string }
  all_time: {
    sessions: number; total_tools: number; active_days: number; projects: number
    total_bursts: number; subagent_invocations: number
    cache_read_tokens: number; cache_creation_tokens: number; files_unique: number
  }
  window_stats: { sessions: number; tools: number; bursts: number; active_days: number; cache_read: number; cache_create: number }
  prev_stats: { sessions: number; tools: number; bursts: number }
  daily: DailyPoint[]
  weekly: WeeklyPoint[]
  session_scatter: ScatterPoint[]
  project_daily: Record<string, Record<string, number>>
  hour_dow_matrix: number[][]
  size_classes: Record<string, number>
  tool_counts: Record<string, number>
  burst_stats: {
    count: number; avg_intensity: number; avg_duration_seconds: number
    dominant_tools: Record<string, number>; size_classes: Record<string, number>
  }
  top_projects: ProjectRow[]
  branch_activity: BranchRow[]
  top_files: FileRow[]
  agentic: { total_subagent_invocations: number; sessions_with_subagents: number; sessions_total: number; avg_agentic_ratio: number; avg_tools_per_minute: number }
  cache: { read_tokens: number; creation_tokens: number; hit_rate_pct: number }
  duration: { avg: number; p50: number; p95: number }
  heatmap: HeatmapPoint[]
  today: SnapShot
  yesterday: SnapShot
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtNum(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}
function deltaStr(curr: number, prev: number): { str: string; up: boolean } | null {
  if (!prev) return null
  const pct = ((curr - prev) / prev) * 100
  return { str: `${pct >= 0 ? '+' : ''}${Math.round(pct)}% vs prior`, up: pct >= 0 }
}
function basename(p: string) { return p.split('/').pop() ?? p }
function hexToRgb(hex: string) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)] as const
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-stone-900 text-stone-100 text-xs px-2 py-1 shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
        {label}
      </span>
    </span>
  )
}

function StatCard({ label, value, sub, color, delta: d }: {
  label: string; value: string | number; sub?: string; color?: string
  delta?: { str: string; up: boolean } | null
}) {
  return (
    <div className="bg-white border border-stone-200 p-4 shadow-sm">
      <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: color ?? '#1c1412' }}>{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {sub && <div className="text-xs text-stone-400">{sub}</div>}
        {d && <span className={clsx('text-xs font-semibold', d.up ? 'text-emerald-600' : 'text-rose-500')}>{d.str}</span>}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="bg-white border border-stone-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-stone-700">{title}</h2>
          {subtitle && <p className="text-xs text-stone-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function HBar({ label, value, max, color, badge }: { label: string; value: number; max: number; color: string; badge?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-stone-500 w-24 shrink-0 truncate" title={label}>{label}</span>
      <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-stone-400 tabular-nums w-14 text-right">{badge ?? fmtNum(value)}</span>
    </div>
  )
}

// ─── Today / Yesterday snapshot bar ──────────────────────────────────────────

function DaySnapshot({ label, snap, accent }: { label: string; snap: SnapShot; accent: string }) {
  if (snap.sessions === 0) return (
    <div className="border border-stone-100 p-3">
      <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xs text-stone-300 italic">No sessions</div>
    </div>
  )
  return (
    <div className="border border-stone-100 p-3">
      <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">{label}</div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-bold tabular-nums" style={{ color: accent }}>{snap.sessions}</span>
        <span className="text-xs text-stone-400">sessions</span>
        <span className="text-base font-semibold tabular-nums text-stone-600">{fmtNum(snap.tools)}</span>
        <span className="text-xs text-stone-400">tools</span>
        {snap.bursts > 0 && <><span className="text-base font-semibold tabular-nums" style={{ color: CC_DIM }}>{snap.bursts}</span><span className="text-xs text-stone-400">bursts</span></>}
      </div>
      {snap.projects.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {snap.projects.slice(0, 4).map(p => (
            <span key={p} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 border border-violet-100">{p}</span>
          ))}
        </div>
      )}
      {snap.branches.length > 0 && (
        <div className="text-xs text-stone-400 mt-1 font-mono">
          {snap.branches.slice(0, 3).join(' · ')}
        </div>
      )}
    </div>
  )
}

// ─── Contribution heatmap ─────────────────────────────────────────────────────

function ContribHeatmap({ heatmap }: { heatmap: HeatmapPoint[] }) {
  const CELL = 13, GAP = 2
  const byDate: Record<string, number> = {}
  for (const h of heatmap) byDate[h.date] = h.sessions
  const max = Math.max(...Object.values(byDate), 1)

  const today = new Date(); today.setUTCHours(0,0,0,0)
  const snap = new Date(today); snap.setUTCDate(snap.getUTCDate() - 52*7+1)
  snap.setUTCDate(snap.getUTCDate() - snap.getUTCDay())

  const weeks: Array<Array<{ date: string; sessions: number }>> = []
  const cur = new Date(snap)
  for (let w = 0; w < 53; w++) {
    const week: Array<{ date: string; sessions: number }> = []
    for (let d = 0; d < 7; d++) {
      const iso = cur.toISOString().slice(0, 10)
      week.push({ date: iso, sessions: byDate[iso] ?? 0 })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    weeks.push(week)
  }

  const monthLabels: Array<{ label: string; col: number }> = []
  weeks.forEach((week, wi) => {
    const d = new Date(week[0].date + 'T12:00:00Z')
    if (d.getUTCDate() <= 7 || wi === 0)
      monthLabels.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), col: wi })
  })

  const [r, g, b] = hexToRgb(CC)
  function cellColor(n: number) {
    if (!n) return '#ede8df'
    const t = Math.min(n / Math.min(max, 5), 1)
    return `rgb(${Math.round(237 - t*(237-r))},${Math.round(233 - t*(233-g))},${Math.round(254 - t*(254-b))})`
  }

  const totalSessions = heatmap.reduce((s, h) => s + h.sessions, 0)
  const activeDays = heatmap.filter(h => h.sessions > 0).length

  return (
    <div className="overflow-x-auto">
      <div className="flex mb-1" style={{ gap: GAP, paddingLeft: 28 }}>
        {weeks.map((_, wi) => {
          const ml = monthLabels.find(m => m.col === wi)
          return <div key={wi} style={{ width: CELL, flexShrink: 0, fontSize: 9 }} className="text-stone-400 overflow-visible whitespace-nowrap">{ml?.label ?? ''}</div>
        })}
      </div>
      <div className="flex" style={{ gap: GAP }}>
        <div className="flex flex-col shrink-0" style={{ gap: GAP, width: 24 }}>
          {['', 'M', '', 'W', '', 'F', ''].map((l, i) => (
            <div key={i} style={{ height: CELL, fontSize: 9 }} className="text-stone-400 text-right pr-1 flex items-center justify-end">{l}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
            {week.map(({ date, sessions }) => (
              <Tip key={date} label={sessions ? `${fmtDate(date)}: ${sessions} session${sessions !== 1 ? 's' : ''}` : fmtDate(date)}>
                <div style={{ width: CELL, height: CELL, borderRadius: 2, flexShrink: 0, backgroundColor: cellColor(sessions) }} />
              </Tip>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-xs text-stone-400">
        <span>less</span>
        {[0,1,2,3,4].map(i => <div key={i} style={{ width: CELL, height: CELL, borderRadius: 2, backgroundColor: cellColor(i * (max/4)) }} />)}
        <span>more</span>
        <span className="ml-3 font-medium text-stone-600">{totalSessions} sessions · {activeDays} active days this year</span>
      </div>
    </div>
  )
}

// ─── Overlay line chart (sessions + bursts over time) ─────────────────────────

function ActivityTimeline({ daily }: { daily: DailyPoint[] }) {
  const [mode, setMode] = useState<'sessions' | 'tools' | 'bursts'>('sessions')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const PAD_L = 36, PAD_T = 10, PAD_B = 22, H = 140

  const vals = daily.map(d => mode === 'sessions' ? d.sessions : mode === 'tools' ? d.tools : d.bursts)
  const maxV = Math.max(...vals, 1)
  const W = 800

  const [r, g, b] = hexToRgb(CC)

  const pts = vals.map((v, i) => {
    const x = PAD_L + (i / Math.max(daily.length - 1, 1)) * (W - PAD_L)
    const y = PAD_T + H - Math.max((v / maxV) * H, 0)
    return { x, y, v }
  })

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = pts.length > 1
    ? `M${PAD_L},${PAD_T + H} L${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L${W},${PAD_T + H} Z`
    : ''

  const gridVals = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div>
      <div className="flex items-center gap-1 mb-4">
        {(['sessions', 'tools', 'bursts'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={clsx('text-xs px-3 py-1 border transition-colors capitalize', mode === m ? 'text-white border-transparent' : 'border-stone-200 text-stone-500 hover:border-stone-400')}
            style={mode === m ? { backgroundColor: CC } : {}}
          >{m}</button>
        ))}
      </div>
      <div className="relative select-none">
        <svg viewBox={`0 0 ${W} ${H + PAD_T + PAD_B}`} className="w-full overflow-visible" preserveAspectRatio="none"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
            const relX = e.clientX - rect.left - (PAD_L / W) * rect.width
            const plotW = rect.width * ((W - PAD_L) / W)
            const idx = Math.round((relX / plotW) * (daily.length - 1))
            setHoverIdx(Math.max(0, Math.min(daily.length - 1, idx)))
          }}
        >
          {gridVals.map(frac => {
            const y = PAD_T + H - frac * H
            return (
              <g key={frac}>
                <line x1={PAD_L} y1={y} x2={W} y2={y} stroke="#f0ece4" strokeWidth={1} />
                <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#a8a29e">{Math.round(maxV * frac)}</text>
              </g>
            )
          })}
          {areaPath && <path d={areaPath} fill={CC} opacity={0.07} />}
          {linePath && <path d={linePath} fill="none" stroke={CC} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
          {hoverIdx !== null && pts[hoverIdx] && (
            <>
              <line x1={pts[hoverIdx].x} y1={PAD_T} x2={pts[hoverIdx].x} y2={PAD_T + H} stroke="#a8a29e" strokeWidth={1} strokeDasharray="3,3" />
              <circle cx={pts[hoverIdx].x} cy={pts[hoverIdx].y} r={4} fill={CC} stroke="white" strokeWidth={2} />
            </>
          )}
          <g transform={`translate(0,${PAD_T + H + 12})`}>
            {daily.map((d, i) => {
              const step = Math.max(1, Math.ceil(daily.length / 10))
              if (i % step !== 0 && i !== daily.length - 1) return null
              const x = PAD_L + (i / Math.max(daily.length - 1, 1)) * (W - PAD_L)
              return <text key={d.date} x={x} textAnchor="middle" fontSize={8} fill="#a8a29e">{fmtDate(d.date)}</text>
            })}
          </g>
        </svg>
        {hoverIdx !== null && daily[hoverIdx] && (
          <div className="absolute top-2 right-0 bg-white border border-stone-200 shadow-lg p-2.5 text-xs pointer-events-none z-10 min-w-[160px]">
            <div className="font-semibold text-stone-600 mb-1.5">{fmtDate(daily[hoverIdx].date)}</div>
            <div className="space-y-0.5 text-stone-500">
              <div className="flex justify-between gap-4"><span>Sessions</span><span className="font-mono font-semibold" style={{ color: CC }}>{daily[hoverIdx].sessions}</span></div>
              <div className="flex justify-between gap-4"><span>Tools</span><span className="font-mono font-semibold" style={{ color: CC }}>{fmtNum(daily[hoverIdx].tools)}</span></div>
              <div className="flex justify-between gap-4"><span>Bursts</span><span className="font-mono font-semibold" style={{ color: CC }}>{daily[hoverIdx].bursts}</span></div>
              <div className="flex justify-between gap-4"><span>Agentic ratio</span><span className="font-mono font-semibold" style={{ color: CC }}>{daily[hoverIdx].avg_agentic}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Session character scatter ────────────────────────────────────────────────
// X = duration (min), Y = tool calls — reveals session "shape"

function SessionScatter({ scatter }: { scatter: ScatterPoint[] }) {
  const [hover, setHover] = useState<ScatterPoint | null>(null)
  if (scatter.length === 0) return <div className="text-xs text-stone-300 italic">No session data</div>

  const maxDur  = Math.max(...scatter.map(s => s.duration_min), 1)
  const maxTools = Math.max(...scatter.map(s => s.tool_calls), 1)
  const PAD_L = 44, PAD_T = 8, PAD_B = 28, PAD_R = 16, W = 800, H = 200

  function x(d: number) { return PAD_L + (Math.min(d, maxDur) / maxDur) * (W - PAD_L - PAD_R) }
  function y(t: number) { return PAD_T + H - (Math.min(t, maxTools) / maxTools) * H }

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxDur * f))
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxTools * f))

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + PAD_T + PAD_B}`} className="w-full overflow-visible" preserveAspectRatio="none">
        {/* Grid */}
        {yTicks.map(v => {
          const yp = y(v)
          return (
            <g key={v}>
              <line x1={PAD_L} y1={yp} x2={W - PAD_R} y2={yp} stroke="#f0ece4" strokeWidth={1} />
              <text x={PAD_L - 4} y={yp + 3} textAnchor="end" fontSize={8} fill="#a8a29e">{fmtNum(v)}</text>
            </g>
          )
        })}
        {xTicks.map(v => {
          const xp = x(v)
          return (
            <g key={v}>
              <line x1={xp} y1={PAD_T} x2={xp} y2={PAD_T + H} stroke="#f0ece4" strokeWidth={1} />
              <text x={xp} y={PAD_T + H + 14} textAnchor="middle" fontSize={8} fill="#a8a29e">{v}m</text>
            </g>
          )
        })}
        {/* Axis labels */}
        <text x={PAD_L - 4} y={PAD_T - 2} textAnchor="end" fontSize={8} fill="#a8a29e">tools</text>
        <text x={W - PAD_R} y={PAD_T + H + 24} textAnchor="end" fontSize={8} fill="#a8a29e">duration (min)</text>
        {/* Points */}
        {scatter.map((s, i) => {
          const meta = SIZE_META[s.size_class] ?? SIZE_META.quick
          const cx = x(s.duration_min), cy = y(s.tool_calls)
          const r = s.subagents > 0 ? 6 : 4.5
          return (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill={meta.color} fillOpacity={0.8} stroke="white" strokeWidth={1}
              onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.project} · ${fmtDate(s.date)} · ${s.duration_min}m · ${s.tool_calls} tools · ${s.size_class}${s.subagents > 0 ? ` · ${s.subagents} subagents` : ''}`}</title>
            </circle>
          )
        })}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-stone-500">
        {Object.entries(SIZE_META).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
            <span>{v.label} <span className="text-stone-300">({v.desc})</span></span>
          </div>
        ))}
        <span className="text-stone-300 ml-2">larger dot = used subagents</span>
      </div>
      {hover && (
        <div className="mt-2 p-2 bg-violet-50 border border-violet-100 text-xs text-stone-600">
          <span className="font-semibold">{hover.project}</span> · {fmtDate(hover.date)} · {hover.duration_min}m · {hover.tool_calls} tools · ratio {hover.agentic_ratio} · {hover.size_class}
          {hover.subagents > 0 && <span className="text-violet-600 ml-2">{hover.subagents} subagents</span>}
        </div>
      )}
    </div>
  )
}

// ─── Tool mix area / stacked bar over time ───────────────────────────────────

function ToolMixChart({ daily }: { daily: DailyPoint[] }) {
  const TOP_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Task']

  // Compute per-day fractions for TOP_TOOLS, group rest into Other
  const series = daily.filter(d => d.sessions > 0).map(d => {
    const total = Object.values(d.tool_mix).reduce((s, c) => s + c, 0) || 1
    const toolPcts: Record<string, number> = {}
    let rest = total
    for (const t of TOP_TOOLS) {
      toolPcts[t] = ((d.tool_mix[t] || 0) / total) * 100
      rest -= d.tool_mix[t] || 0
    }
    toolPcts['Other'] = Math.max(rest / total * 100, 0)
    return { date: d.date, toolPcts }
  })

  if (series.length === 0) return <div className="text-xs text-stone-300 italic">No tool data</div>

  const PAD_L = 36, PAD_T = 8, PAD_B = 22, H = 120, W = 800
  const toolsToShow = [...TOP_TOOLS, 'Other'].filter(t => series.some(s => (s.toolPcts[t] ?? 0) > 0.5))
  const colors = [...TOP_TOOLS.map(t => TOOL_COLORS[t] ?? '#a8a29e'), '#d6d3d1']

  // Stacked area: compute cumulative y per tool per day
  function stackedPath(toolIdx: number): string {
    // Upper boundary
    const upper = series.map((s, i) => {
      const x = PAD_L + (i / Math.max(series.length - 1, 1)) * (W - PAD_L)
      let cum = 0
      for (let ti = 0; ti <= toolIdx; ti++) cum += s.toolPcts[toolsToShow[ti]] ?? 0
      const y = PAD_T + H - (cum / 100) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    // Lower boundary (reversed)
    const lower = series.map((s, i) => {
      const x = PAD_L + (i / Math.max(series.length - 1, 1)) * (W - PAD_L)
      let cum = 0
      for (let ti = 0; ti < toolIdx; ti++) cum += s.toolPcts[toolsToShow[ti]] ?? 0
      const y = PAD_T + H - (cum / 100) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).reverse()
    return `M${upper[0]} L${upper.join(' L ')} L${lower[0]} L${lower.join(' L ')} Z`
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + PAD_T + PAD_B}`} className="w-full overflow-visible" preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PAD_T + H - f * H
          return <g key={f}>
            <line x1={PAD_L} y1={y} x2={W} y2={y} stroke="#f0ece4" strokeWidth={1} />
            <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#a8a29e">{Math.round(f * 100)}%</text>
          </g>
        })}
        {toolsToShow.map((t, ti) => (
          <path key={t} d={stackedPath(ti)} fill={colors[ti] ?? '#c4b5fd'} opacity={0.8} />
        ))}
        <g transform={`translate(0,${PAD_T + H + 12})`}>
          {series.map((s, i) => {
            const step = Math.max(1, Math.ceil(series.length / 8))
            if (i % step !== 0 && i !== series.length - 1) return null
            const x = PAD_L + (i / Math.max(series.length - 1, 1)) * (W - PAD_L)
            return <text key={s.date} x={x} textAnchor="middle" fontSize={8} fill="#a8a29e">{fmtDate(s.date)}</text>
          })}
        </g>
      </svg>
      <div className="flex flex-wrap gap-3 mt-2">
        {toolsToShow.map((t, ti) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[ti] }} />
            <span className="text-xs text-stone-500">{t}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Agentic ratio trend ──────────────────────────────────────────────────────

function AgenticTrend({ daily }: { daily: DailyPoint[] }) {
  const active = daily.filter(d => d.sessions > 0 && d.avg_agentic > 0)
  if (active.length < 2) return <div className="text-xs text-stone-300 italic">Insufficient data</div>

  const PAD_L = 36, PAD_T = 8, PAD_B = 22, H = 100, W = 800
  const maxV = Math.max(...active.map(d => d.avg_agentic), 1)

  const pts = active.map((d, i) => {
    const x = PAD_L + (i / Math.max(active.length - 1, 1)) * (W - PAD_L)
    const y = PAD_T + H - (d.avg_agentic / maxV) * H
    return { x, y, d }
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = pts.length > 1
    ? `M${PAD_L},${PAD_T+H} L${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L${W},${PAD_T+H} Z`
    : ''

  // Trend: first half avg vs second half avg
  const half = Math.floor(active.length / 2)
  const firstHalf = active.slice(0, half)
  const secondHalf = active.slice(half)
  const avg1 = firstHalf.reduce((s, d) => s + d.avg_agentic, 0) / firstHalf.length
  const avg2 = secondHalf.reduce((s, d) => s + d.avg_agentic, 0) / secondHalf.length
  const trend = avg2 > avg1 + 0.5 ? 'improving' : avg2 < avg1 - 0.5 ? 'declining' : 'stable'

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className={clsx('text-xs font-semibold px-2 py-0.5 border',
          trend === 'improving' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
          trend === 'declining' ? 'text-rose-700 bg-rose-50 border-rose-200' :
          'text-stone-500 bg-stone-50 border-stone-200'
        )}>
          {trend === 'improving' ? '↑ becoming more agentic' : trend === 'declining' ? '↓ fewer tools per prompt' : '→ stable'}
        </span>
        <span className="text-xs text-stone-400">avg {avg2.toFixed(1)} tools/prompt now vs {avg1.toFixed(1)} earlier</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + PAD_T + PAD_B}`} className="w-full overflow-visible" preserveAspectRatio="none">
        {[0, 0.5, 1].map(f => {
          const y = PAD_T + H - f * H
          return <g key={f}><line x1={PAD_L} y1={y} x2={W} y2={y} stroke="#f0ece4" strokeWidth={1} /><text x={PAD_L-4} y={y+3} textAnchor="end" fontSize={8} fill="#a8a29e">{(maxV * f).toFixed(1)}</text></g>
        })}
        {area && <path d={area} fill={CC} opacity={0.07} />}
        <path d={line} fill="none" stroke={CC} strokeWidth={2} strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={CC} fillOpacity={0.6} />)}
        <g transform={`translate(0,${PAD_T+H+12})`}>
          {active.map((d, i) => {
            const step = Math.max(1, Math.ceil(active.length / 8))
            if (i % step !== 0 && i !== active.length - 1) return null
            const x = PAD_L + (i / Math.max(active.length-1, 1)) * (W - PAD_L)
            return <text key={d.date} x={x} textAnchor="middle" fontSize={8} fill="#a8a29e">{fmtDate(d.date)}</text>
          })}
        </g>
      </svg>
      <p className="text-xs text-stone-400 mt-2">Agentic ratio = tool calls per user prompt. Higher means Claude is doing more per instruction — a proxy for workflow maturity.</p>
    </div>
  )
}

// ─── Hour × DOW matrix ────────────────────────────────────────────────────────

function HourDowMatrix({ matrix }: { matrix: number[][] }) {
  const maxVal = Math.max(...matrix.flat(), 1)
  const CELL_W = 24, CELL_H = 20, GAP = 2, PAD_L = 28

  const [r, g, b] = hexToRgb(CC)
  function cellColor(n: number) {
    if (!n) return '#f5f0e8'
    const t = Math.min(n / maxVal, 1)
    return `rgb(${Math.round(237 - t*(237-r))},${Math.round(233 - t*(233-g))},${Math.round(254 - t*(254-b))})`
  }

  const totalW = PAD_L + 24 * (CELL_W + GAP)
  const totalH = 7 * (CELL_H + GAP) + 20

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${totalW} ${totalH}`} className="w-full" style={{ minWidth: 500 }} preserveAspectRatio="xMinYMin meet">
        {/* Hour labels */}
        {Array.from({ length: 24 }, (_, h) => (
          h % 4 === 0 ? <text key={h} x={PAD_L + h * (CELL_W + GAP) + CELL_W / 2} y={totalH - 4} textAnchor="middle" fontSize={8} fill="#a8a29e">{`${h}h`}</text> : null
        ))}
        {/* Cells */}
        {matrix.map((row, dow) => (
          row.map((count, hour) => {
            const sessions = count
            return (
              <g key={`${dow}-${hour}`}>
                <rect
                  x={PAD_L + hour * (CELL_W + GAP)}
                  y={dow * (CELL_H + GAP)}
                  width={CELL_W} height={CELL_H}
                  fill={cellColor(sessions)} rx={2}
                >
                  <title>{`${DOW_LABELS[dow]} ${hour.toString().padStart(2,'0')}:00 — ${sessions} session${sessions !== 1 ? 's' : ''}`}</title>
                </rect>
              </g>
            )
          })
        ))}
        {/* DOW labels */}
        {DOW_LABELS.map((l, i) => (
          <text key={l} x={PAD_L - 4} y={i * (CELL_H + GAP) + CELL_H / 2 + 3} textAnchor="end" fontSize={9} fill="#78716c">{l}</text>
        ))}
      </svg>
      <div className="flex items-center gap-1.5 mt-2 text-xs text-stone-400">
        <span>less</span>
        {[0,1,2,3,4].map(i => <div key={i} style={{ width: 14, height: 14, borderRadius: 2, backgroundColor: cellColor(i * (maxVal/4)) }} />)}
        <span>more</span>
      </div>
    </div>
  )
}

// ─── Project timeline heatmap ─────────────────────────────────────────────────

function ProjectTimeline({ projects, projectDaily, daily }: {
  projects: ProjectRow[]; projectDaily: Record<string, Record<string, number>>; daily: DailyPoint[]
}) {
  const dates = daily.map(d => d.date)
  const active = projects.filter(p => dates.some(d => (projectDaily[p.id]?.[d] || 0) > 0))
  if (active.length === 0) return <div className="text-xs text-stone-300 italic">No project data</div>

  const [r, g, b] = hexToRgb(CC)
  const globalMax = Math.max(...active.flatMap(p => dates.map(d => projectDaily[p.id]?.[d] || 0)), 1)
  const CELL = 10, GAP = 1

  function cellColor(n: number) {
    if (!n) return '#ede8df'
    const t = Math.min(0.15 + (n / Math.min(globalMax, 5)) * 0.85, 1)
    return `rgb(${Math.round(237 - t*(237-r))},${Math.round(233 - t*(233-g))},${Math.round(254 - t*(254-b))})`
  }

  return (
    <div className="overflow-x-auto space-y-1.5">
      {active.slice(0, 10).map(proj => {
        const pd = projectDaily[proj.id] || {}
        return (
          <div key={proj.id} className="flex items-center gap-2">
            <div className="w-28 shrink-0 text-right">
              <span className="text-xs text-stone-500 font-medium truncate block">{proj.id}</span>
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {dates.map(date => {
                const count = pd[date] || 0
                return (
                  <Tip key={date} label={count > 0 ? `${proj.id} · ${fmtDate(date)}: ${count}` : `${proj.id} · ${fmtDate(date)}`}>
                    <div style={{ width: CELL, height: CELL, borderRadius: 1, flexShrink: 0, backgroundColor: cellColor(count) }} />
                  </Tip>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Session size bars ────────────────────────────────────────────────────────

function SizeBars({ sizes }: { sizes: Record<string, number> }) {
  const total = Object.values(sizes).reduce((a, b) => a + b, 0)
  return (
    <div className="space-y-2.5">
      {Object.entries(SIZE_META).map(([k, meta]) => {
        const count = sizes[k] || 0
        const pct = total > 0 ? Math.round((count / total) * 100) : 0
        return (
          <div key={k}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-stone-500">{meta.label} <span className="text-stone-300">{meta.desc}</span></span>
              <span className="text-stone-400">{count} <span className="text-stone-300">({pct}%)</span></span>
            </div>
            <div className="bg-stone-100 h-2.5 overflow-hidden">
              <div className="h-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tool anatomy ─────────────────────────────────────────────────────────────

function ToolAnatomy({ toolCounts }: { toolCounts: Record<string, number> }) {
  const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])
  const maxV = sorted[0]?.[1] ?? 1
  const reads = toolCounts['Read'] || 0
  const edits = (toolCounts['Edit'] || 0) + (toolCounts['MultiEdit'] || 0)
  const ratio = reads > 0 ? (edits / reads).toFixed(2) : '—'
  const mode = typeof ratio === 'string' && ratio !== '—' && parseFloat(ratio) >= 1 ? 'execution' : 'exploration'

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="border border-stone-100 p-3">
          <div className="text-xs text-stone-400 mb-0.5">Edit:Read ratio</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: CC }}>{ratio}</div>
          <div className="text-xs text-stone-400 capitalize">{mode} mode</div>
        </div>
        <div className="border border-stone-100 p-3">
          <div className="text-xs text-stone-400 mb-0.5">Read calls</div>
          <div className="text-2xl font-bold tabular-nums text-stone-600">{fmtNum(reads)}</div>
        </div>
        <div className="border border-stone-100 p-3">
          <div className="text-xs text-stone-400 mb-0.5">Edit/Write calls</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: CC_DARK }}>{fmtNum(edits)}</div>
        </div>
      </div>
      {sorted.map(([tool, count]) => (
        <HBar key={tool} label={tool} value={count} max={maxV} color={TOOL_COLORS[tool] ?? CC_DIM} badge={fmtNum(count)} />
      ))}
    </div>
  )
}

// ─── Burst intelligence ───────────────────────────────────────────────────────

function BurstSection({ burst }: { burst: ClaudashData['burst_stats'] }) {
  const domSorted = Object.entries(burst.dominant_tools).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const domMax = domSorted[0]?.[1] ?? 1
  const burstTotal = Object.values(burst.size_classes).reduce((a, b) => a + b, 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Metrics */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-stone-100 p-3">
            <div className="text-xs text-stone-400 mb-0.5">Total bursts</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: CC }}>{burst.count}</div>
          </div>
          <div className="border border-stone-100 p-3">
            <div className="text-xs text-stone-400 mb-0.5">Avg intensity</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: CC }}>{burst.avg_intensity.toFixed(1)}</div>
            <div className="text-xs text-stone-400">tools/min</div>
          </div>
          <div className="border border-stone-100 p-3">
            <div className="text-xs text-stone-400 mb-0.5">Avg duration</div>
            <div className="text-2xl font-bold tabular-nums text-stone-600">{Math.round(burst.avg_duration_seconds / 60)}m</div>
          </div>
          <div className="border border-stone-100 p-3">
            <div className="text-xs text-stone-400 mb-0.5">Burst / session</div>
            <div className="text-2xl font-bold tabular-nums text-stone-600">
              {burst.count > 0 && burstTotal > 0 ? (burst.count / burstTotal * Object.values(burst.size_classes).reduce((a,b)=>a+b,0)).toFixed(1) : '—'}
            </div>
          </div>
        </div>
        {/* Size classes */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Burst character</div>
          {Object.entries(BURST_META).map(([k, meta]) => {
            const count = burst.size_classes[k] || 0
            const pct = burstTotal > 0 ? Math.round((count / burstTotal) * 100) : 0
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs text-stone-500 w-16 shrink-0">{meta.label}</span>
                <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                </div>
                <span className="text-xs text-stone-400 w-8 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
      {/* Dominant tools */}
      <div className="lg:col-span-2">
        <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">What triggers bursts — dominant tool</div>
        <div className="space-y-2">
          {domSorted.map(([tool, count]) => (
            <HBar key={tool} label={tool} value={count} max={domMax} color={TOOL_COLORS[tool] ?? CC_DIM} badge={`${count} bursts`} />
          ))}
        </div>
        <p className="text-xs text-stone-400 mt-4">
          A burst is ≥10 tool calls in ≤5 min with ≥60s idle before/after. The dominant tool names the burst character — Edit bursts mean execution flow; Read bursts mean research mode.
        </p>
      </div>
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function ClaudashApp() {
  const [data, setData]     = useState<ClaudashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays]     = useState('30')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/claudash?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  const d = data

  return (
    <main className="flex-1 p-5 space-y-5 max-w-[1400px] mx-auto w-full">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-stone-800">Claude Code Intelligence</h1>
          <p className="text-xs text-stone-400 mt-0.5">Session depth · tool anatomy · burst patterns · agentic trajectory</p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-stone-200 p-1 shadow-sm">
          {DAY_OPTIONS.map(({ label, value }) => (
            <button key={value} onClick={() => setDays(value)}
              className={clsx('text-xs px-3 py-1 font-medium transition-colors',
                days === value ? 'bg-violet-700 text-white' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
              )}
            >{label}</button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <span className="text-sm text-stone-400 animate-pulse">Loading Claude Code data…</span>
        </div>
      )}

      {!loading && d && !d.empty && (
        <>
          {/* ── Today / Yesterday ───────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DaySnapshot label="Today" snap={d.today} accent={CC} />
            <DaySnapshot label="Yesterday" snap={d.yesterday} accent={CC_DIM} />
          </div>

          {/* ── All-time stat row ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Sessions" value={d.window_stats.sessions.toLocaleString()}
              sub={`${d.window_stats.active_days} active days`} color={CC}
              delta={deltaStr(d.window_stats.sessions, d.prev_stats.sessions)} />
            <StatCard label="Tool calls" value={fmtNum(d.window_stats.tools)}
              sub={`${d.window_stats.bursts} bursts`} color={CC_DARK}
              delta={deltaStr(d.window_stats.tools, d.prev_stats.tools)} />
            <StatCard label="Avg session" value={`${d.duration.avg}m`}
              sub={`p50 ${d.duration.p50}m · p95 ${d.duration.p95}m`} />
            <StatCard label="Agentic ratio" value={d.agentic.avg_agentic_ratio}
              sub={`${d.agentic.avg_tools_per_minute} tools/min avg`} color={CC} />
          </div>

          {/* ── All-time callouts ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="All-time sessions" value={d.all_time.sessions.toLocaleString()} sub={`${d.all_time.active_days} days active`} />
            <StatCard label="All-time tools" value={fmtNum(d.all_time.total_tools)} sub={`${d.all_time.total_bursts} total bursts`} />
            <StatCard label="Subagents" value={d.agentic.total_subagent_invocations.toLocaleString()}
              sub={`${d.agentic.sessions_with_subagents} sessions used agents`} color="#6d28d9" />
            <StatCard label="Cache hit rate" value={`${d.cache.hit_rate_pct}%`}
              sub={`${fmtNum(d.cache.read_tokens)} read · ${fmtNum(d.cache.creation_tokens)} written`} color="#059669" />
          </div>

          {/* ── Session contributions heatmap ────────────────────────────────── */}
          <Section title="Session Contributions" subtitle="52 weeks · colour intensity = sessions that day">
            <ContribHeatmap heatmap={d.heatmap} />
          </Section>

          {/* ── Activity timeline ────────────────────────────────────────────── */}
          <Section title="Activity Timeline"
            subtitle="Sessions, tool calls, and bursts per day — toggle to compare signals">
            <ActivityTimeline daily={d.daily} />
          </Section>

          {/* ── Session character scatter ─────────────────────────────────────── */}
          <Section title="Session Character"
            subtitle="Each dot = one session · X = duration · Y = tool calls · reveals your work style">
            <SessionScatter scatter={d.session_scatter} />
          </Section>

          {/* ── Session depth + Project timeline ─────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Section title="Session Depth" subtitle="How deep is your typical session?">
              <SizeBars sizes={d.size_classes} />
            </Section>
            <Section title="Project Momentum"
              subtitle="Which projects are getting your Claude time in this window">
              <ProjectTimeline projects={d.top_projects} projectDaily={d.project_daily} daily={d.daily} />
            </Section>
          </div>

          {/* ── Tool anatomy ─────────────────────────────────────────────────── */}
          <Section title="Tool Anatomy"
            subtitle="What you're actually doing — Read-heavy = exploration, Edit-heavy = execution">
            <ToolAnatomy toolCounts={d.tool_counts} />
          </Section>

          {/* ── Tool mix over time ───────────────────────────────────────────── */}
          <Section title="Tool Mix Over Time"
            subtitle="How the composition of your tool use shifts across the period">
            <ToolMixChart daily={d.daily} />
          </Section>

          {/* ── Agentic trajectory ───────────────────────────────────────────── */}
          <Section title="Agentic Trajectory"
            subtitle="Average tool calls per user prompt — higher = Claude doing more per instruction">
            <AgenticTrend daily={d.daily} />
          </Section>

          {/* ── Burst intelligence ───────────────────────────────────────────── */}
          <Section title="Burst Intelligence"
            subtitle="Concentrated tool-call storms — the texture of intense work">
            <BurstSection burst={d.burst_stats} />
          </Section>

          {/* ── Timing fingerprint ───────────────────────────────────────────── */}
          <Section title="Timing Fingerprint"
            subtitle="Sessions per hour × day of week — when do you actually code?">
            <HourDowMatrix matrix={d.hour_dow_matrix} />
          </Section>

          {/* ── Files + Branches ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Section title="Most Touched Files" subtitle="Files read or written most across all sessions in window">
              <div className="space-y-1.5">
                {d.top_files.map(f => (
                  <div key={f.path} className="flex items-center gap-2">
                    <Tip label={f.path}>
                      <span className="text-xs font-mono text-stone-500 w-48 shrink-0 truncate">{basename(f.path)}</span>
                    </Tip>
                    <div className="flex-1 bg-stone-100 h-1.5 overflow-hidden">
                      <div className="h-full" style={{ width: `${(f.count / (d.top_files[0]?.count ?? 1)) * 100}%`, backgroundColor: CC }} />
                    </div>
                    <span className="text-xs text-stone-400 tabular-nums w-6 text-right">{f.count}</span>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Branch Activity" subtitle="Sessions per git branch">
              <div className="space-y-2">
                {d.branch_activity.map(b => (
                  <div key={b.branch} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-stone-500 w-40 shrink-0 truncate" title={b.branch}>{b.branch}</span>
                    <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
                      <div className="h-full" style={{ width: `${(b.sessions / (d.branch_activity[0]?.sessions ?? 1)) * 100}%`, backgroundColor: CC_DIM }} />
                    </div>
                    <span className="text-xs text-stone-400 tabular-nums w-6 text-right">{b.sessions}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </>
      )}

      {!loading && (!d || d.empty) && (
        <div className="bg-white border border-stone-200 p-12 text-center shadow-sm">
          <div className="text-stone-400 text-sm">No claude-code events found.</div>
          <div className="text-stone-300 text-xs mt-1">Run <code className="font-mono">/work-harvester-claude-code</code> to harvest sessions.</div>
        </div>
      )}
    </main>
  )
}
