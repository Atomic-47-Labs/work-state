'use client'

import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Nav } from '@/components/nav'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DaySeries {
  date: string
  total: number
  by_surface: Record<string, number>
  by_type: Record<string, number>
  by_project: Record<string, number>
}

interface WeekSeries {
  week: string
  total: number
  by_surface: Record<string, number>
  by_type: Record<string, number>
}

interface ManifestProject {
  id: string
  portfolio: string
  status: string
  priority: number
}

interface TimelineResponse {
  daily_series: DaySeries[]
  project_daily: Record<string, Record<string, number>>
  weekly_series: WeekSeries[]
  summary: { total: number; by_surface: Record<string, number>; by_type: Record<string, number> }
  daily_avg: number
  projects: ManifestProject[]
  all_dates: string[]
  days: number
}

// ─── Style constants ──────────────────────────────────────────────────────────

const SURFACE_META: Record<string, { label: string; color: string }> = {
  github:   { label: 'GitHub',   color: '#a8a29e' },
  slack:    { label: 'Slack',    color: '#c084fc' },
  gmail:    { label: 'Gmail',    color: '#f87171' },
  gdocs:    { label: 'GDocs',    color: '#60a5fa' },
  scsiwyg:  { label: 'Scsiwyg',  color: '#34d399' },
  linkedin: { label: 'LinkedIn', color: '#3b82f6' },
  x:        { label: 'X',        color: '#44403c' },
  substack:     { label: 'Substack',     color: '#fb923c' },
  'claude-code': { label: 'Claude Code', color: '#8b5cf6' },
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  build:        { label: 'Build',      color: '#78716c' },
  'tool-burst': { label: 'Tool Burst', color: '#8b5cf6' },
  draft:        { label: 'Draft',      color: '#34d399' },
  publish:      { label: 'Publish',    color: '#fb923c' },
  share:        { label: 'Share',      color: '#d97706' },
  receive:      { label: 'Receive',    color: '#38bdf8' },
  decide:       { label: 'Decide',     color: '#a78bfa' },
  learn:        { label: 'Learn',      color: '#2dd4bf' },
}

// Behavioural modes — each maps to a set of event types
const MODES = [
  { id: 'code',        label: 'Code',        color: '#78716c', types: ['build'] },
  { id: 'create',      label: 'Create',      color: '#34d399', types: ['draft', 'publish'] },
  { id: 'share',       label: 'Share',       color: '#d97706', types: ['share'] },
  { id: 'communicate', label: 'Communicate', color: '#38bdf8', types: ['receive'] },
] as const

const PORTFOLIO_COLOR: Record<string, string> = {
  worksona: '#d97706', atomic47: '#ea580c', nutabu: '#e11d48',
  aimqc: '#0ea5e9', 'market-research': '#8b5cf6', personal: '#0d9488',
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function rollingAvg(values: number[], window = 7): number[] {
  return values.map((_, i) => {
    const half  = Math.floor(window / 2)
    const start = Math.max(0, i - half)
    const end   = Math.min(values.length, i + half + 1)
    const slice = values.slice(start, end)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

function svgLinePath(values: number[], max: number, W: number, H: number): string {
  if (values.length < 2) return ''
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - Math.max((v / max) * H, 0)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function svgAreaPath(values: number[], max: number, W: number, H: number): string {
  if (values.length < 2) return ''
  const line = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - Math.max((v / max) * H, 0)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' L ')
  return `M0,${H} L${line} L${W},${H} Z`
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

// ─── Tooltip wrapper ──────────────────────────────────────────────────────────

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

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-stone-200 p-4 shadow-sm">
      <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: color ?? '#1c1412' }}>{value}</div>
      {sub && <div className="text-xs text-stone-400 mt-1">{sub}</div>}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
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

// ─── Y-axis tick labels ───────────────────────────────────────────────────────

function YAxis({ max, ticks = 4, H, padTop = 10 }: { max: number; ticks?: number; H: number; padTop?: number }) {
  const vals = Array.from({ length: ticks + 1 }, (_, i) => Math.round((max / ticks) * i))
  return (
    <>
      {vals.map(v => {
        const y = padTop + (H - padTop) - ((v / max) * (H - padTop))
        return (
          <g key={v}>
            <line x1={32} y1={y} x2={36} y2={y} stroke="#d6d3d1" strokeWidth={1} />
            <text x={30} y={y + 3} textAnchor="end" fontSize={8} fill="#a8a29e">{v}</text>
            <line x1={36} y1={y} x2="100%" y2={y} stroke="#f5f5f4" strokeWidth={1} />
          </g>
        )
      })}
    </>
  )
}

// ─── X-axis date labels ───────────────────────────────────────────────────────

function XAxisLabels({ dates, W, padLeft = 36 }: { dates: string[]; W: number; padLeft?: number }) {
  const plotW = W - padLeft
  const step  = Math.max(1, Math.ceil(dates.length / 10))
  return (
    <>
      {dates.map((d, i) => {
        if (i % step !== 0 && i !== dates.length - 1) return null
        const x = padLeft + (i / (dates.length - 1)) * plotW
        return (
          <text key={d} x={x} textAnchor="middle" fontSize={8} fill="#a8a29e">
            {fmtDate(d)}
          </text>
        )
      })}
    </>
  )
}

// ─── Overlay line chart ───────────────────────────────────────────────────────
// Surfaces and/or types as individually toggleable series on shared axes.

interface OverlaySeries {
  id: string
  label: string
  color: string
  values: number[]
}

function OverlayLineChart({
  dates,
  series,
  smooth,
}: {
  dates: string[]
  series: OverlaySeries[]
  smooth: boolean
}) {
  const [active, setActive] = useState<Set<string>>(() => new Set(series.map(s => s.id)))
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const PAD_L = 36, PAD_T = 10, PAD_B = 22
  const H_PLOT = 160

  const processed = series.map(s => ({
    ...s,
    vals: smooth ? rollingAvg(s.values, 7) : s.values,
  }))

  const visibleMax = Math.max(
    ...processed.filter(s => active.has(s.id)).flatMap(s => s.vals),
    1
  )

  function toggle(id: string) {
    setActive(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div>
      {/* Legend toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {series.map(s => {
          const on = active.has(s.id)
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className={clsx(
                'flex items-center gap-1.5 text-xs px-2.5 py-1 border transition-all',
                on ? 'border-transparent text-white' : 'border-stone-200 text-stone-400 bg-white'
              )}
              style={on ? { backgroundColor: s.color } : {}}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: on ? 'white' : s.color }} />
              {s.label}
            </button>
          )
        })}
      </div>

      {/* SVG chart */}
      <div className="relative select-none">
        <svg
          viewBox={`0 0 800 ${H_PLOT + PAD_T + PAD_B}`}
          className="w-full overflow-visible"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
            const relX = e.clientX - rect.left - (PAD_L / 800) * rect.width
            const plotW = rect.width * ((800 - PAD_L) / 800)
            const idx   = Math.round((relX / plotW) * (dates.length - 1))
            setHoverIdx(Math.max(0, Math.min(dates.length - 1, idx)))
          }}
        >
          {/* Grid lines + y-axis */}
          {[0, 0.25, 0.5, 0.75, 1].map(frac => {
            const v = Math.round(visibleMax * frac)
            const y = PAD_T + H_PLOT - frac * H_PLOT
            return (
              <g key={frac}>
                <line x1={PAD_L} y1={y} x2={800} y2={y} stroke="#f0ece4" strokeWidth={1} />
                <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#a8a29e">{v}</text>
              </g>
            )
          })}

          {/* Area fills (subtle) */}
          {processed.filter(s => active.has(s.id)).map(s => {
            const baseline = PAD_T + H_PLOT
            const linePts  = s.vals.map((v, i) => {
              const x = PAD_L + (i / (s.vals.length - 1)) * (800 - PAD_L)
              const y = PAD_T + H_PLOT - Math.max((v / visibleMax) * H_PLOT, 0)
              return `${x.toFixed(1)},${y.toFixed(1)}`
            }).join(' L ')
            const d = `M${PAD_L},${baseline} L${linePts} L${800},${baseline} Z`
            return (
              <path key={`area-${s.id}`} d={d} fill={s.color} opacity={0.06} />
            )
          })}

          {/* Lines */}
          {processed.filter(s => active.has(s.id)).map(s => {
            const pts = s.vals.map((v, i) => {
              const x = PAD_L + (i / (s.vals.length - 1)) * (800 - PAD_L)
              const y = PAD_T + H_PLOT - Math.max((v / visibleMax) * H_PLOT, 0)
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
            }).join(' ')
            return (
              <path
                key={`line-${s.id}`}
                d={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          })}

          {/* Hover crosshair */}
          {hoverIdx !== null && (
            <>
              <line
                x1={PAD_L + (hoverIdx / (dates.length - 1)) * (800 - PAD_L)}
                y1={PAD_T}
                x2={PAD_L + (hoverIdx / (dates.length - 1)) * (800 - PAD_L)}
                y2={PAD_T + H_PLOT}
                stroke="#a8a29e"
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              {processed.filter(s => active.has(s.id)).map(s => {
                const v = s.vals[hoverIdx] ?? 0
                const x = PAD_L + (hoverIdx / (dates.length - 1)) * (800 - PAD_L)
                const y = PAD_T + H_PLOT - Math.max((v / visibleMax) * H_PLOT, 0)
                return (
                  <circle key={s.id} cx={x} cy={y} r={3.5} fill={s.color} stroke="white" strokeWidth={1.5} />
                )
              })}
            </>
          )}

          {/* X-axis labels */}
          <g transform={`translate(0,${PAD_T + H_PLOT + 12})`}>
            {dates.map((d, i) => {
              const step = Math.max(1, Math.ceil(dates.length / 10))
              if (i % step !== 0 && i !== dates.length - 1) return null
              const x = PAD_L + (i / (dates.length - 1)) * (800 - PAD_L)
              return (
                <text key={d} x={x} textAnchor="middle" fontSize={8} fill="#a8a29e">{fmtDate(d)}</text>
              )
            })}
          </g>
        </svg>

        {/* Hover tooltip */}
        {hoverIdx !== null && (
          <div className="absolute top-2 right-0 bg-white border border-stone-200 shadow-lg p-2.5 text-xs space-y-1 pointer-events-none z-10 min-w-[140px]">
            <div className="font-semibold text-stone-600 mb-1.5">{fmtDate(dates[hoverIdx])}</div>
            {processed.filter(s => active.has(s.id)).map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-stone-500">{s.label}</span>
                </div>
                <span className="font-mono font-semibold tabular-nums" style={{ color: s.color }}>
                  {(s.vals[hoverIdx] ?? 0).toFixed(smooth ? 1 : 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Work pattern chart ───────────────────────────────────────────────────────
// Shows Code / Create / Share / Communicate as smoothed overlaid lines.
// Gives an instant read on "what kind of work is dominant this period".

function WorkPatternChart({ series, dates }: { series: DaySeries[]; dates: string[] }) {
  const [smooth, setSmooth] = useState(true)

  const modeSeries: OverlaySeries[] = MODES.map(m => ({
    id: m.id,
    label: m.label,
    color: m.color,
    values: series.map(day =>
      m.types.reduce((sum, t) => sum + (day.by_type[t] || 0), 0)
    ),
  }))

  return (
    <Section
      title="Work Patterns"
      subtitle="Code · Create · Share · Communicate — how time is distributed"
      action={
        <button
          onClick={() => setSmooth(s => !s)}
          className={clsx('text-xs px-3 py-1 border transition-colors', smooth ? 'bg-stone-800 text-white border-stone-800' : 'border-stone-300 text-stone-500 hover:border-stone-500')}
        >
          {smooth ? '7d smooth ✓' : '7d smooth'}
        </button>
      }
    >
      <OverlayLineChart dates={dates} series={modeSeries} smooth={smooth} />
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {MODES.map(m => {
          const total = series.reduce((sum, day) =>
            sum + m.types.reduce((s, t) => s + (day.by_type[t] || 0), 0), 0)
          const peak  = Math.max(...series.map(day =>
            m.types.reduce((s, t) => s + (day.by_type[t] || 0), 0)))
          return (
            <div key={m.id} className="border border-stone-100 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                <span className="text-xs font-semibold text-stone-600">{m.label}</span>
              </div>
              <div className="text-xl font-bold tabular-nums" style={{ color: m.color }}>{total}</div>
              <div className="text-xs text-stone-400">peak: {peak}/day</div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ─── Surface overlay chart ────────────────────────────────────────────────────

function SurfaceOverlayChart({ series, dates }: { series: DaySeries[]; dates: string[] }) {
  const [smooth, setSmooth] = useState(false)

  const activeSurfaces = Object.keys(SURFACE_META).filter(s =>
    series.some(d => (d.by_surface[s] || 0) > 0)
  )

  const overlaySeries: OverlaySeries[] = activeSurfaces.map(s => ({
    id: s,
    label: SURFACE_META[s].label,
    color: SURFACE_META[s].color,
    values: series.map(d => d.by_surface[s] || 0),
  }))

  return (
    <Section
      title="Surface Trends"
      subtitle="Daily events per surface — toggle series to compare"
      action={
        <button
          onClick={() => setSmooth(s => !s)}
          className={clsx('text-xs px-3 py-1 border transition-colors', smooth ? 'bg-stone-800 text-white border-stone-800' : 'border-stone-300 text-stone-500 hover:border-stone-500')}
        >
          {smooth ? '7d smooth ✓' : '7d smooth'}
        </button>
      }
    >
      <OverlayLineChart dates={dates} series={overlaySeries} smooth={smooth} />
    </Section>
  )
}

// ─── Type overlay chart ───────────────────────────────────────────────────────

function TypeOverlayChart({ series, dates }: { series: DaySeries[]; dates: string[] }) {
  const [smooth, setSmooth] = useState(false)

  const activeTypes = Object.keys(TYPE_META).filter(t =>
    series.some(d => (d.by_type[t] || 0) > 0)
  )

  const overlaySeries: OverlaySeries[] = activeTypes.map(t => ({
    id: t,
    label: TYPE_META[t].label,
    color: TYPE_META[t].color,
    values: series.map(d => d.by_type[t] || 0),
  }))

  return (
    <Section
      title="Event Types Over Time"
      subtitle="Daily counts by type — toggle to isolate signals"
      action={
        <button
          onClick={() => setSmooth(s => !s)}
          className={clsx('text-xs px-3 py-1 border transition-colors', smooth ? 'bg-stone-800 text-white border-stone-800' : 'border-stone-300 text-stone-500 hover:border-stone-500')}
        >
          {smooth ? '7d smooth ✓' : '7d smooth'}
        </button>
      }
    >
      <OverlayLineChart dates={dates} series={overlaySeries} smooth={smooth} />
    </Section>
  )
}

// ─── Day-of-week fingerprint ──────────────────────────────────────────────────
// Aggregates events by day of week, split by behavioural mode.
// Reveals M-F discipline, weekend creative bursts, etc.

function DayOfWeekChart({ series }: { series: DaySeries[] }) {
  // Accumulate raw counts per DOW per mode
  const rawByDow: Record<number, Record<string, number>> = {}
  const occurrences: Record<number, number> = {}
  for (let d = 0; d < 7; d++) { rawByDow[d] = {}; occurrences[d] = 0 }

  for (const day of series) {
    const dow = new Date(day.date + 'T12:00:00Z').getUTCDay()
    occurrences[dow]++
    for (const m of MODES) {
      const count = m.types.reduce((s, t) => s + (day.by_type[t] || 0), 0)
      rawByDow[dow][m.id] = (rawByDow[dow][m.id] || 0) + count
    }
  }

  // Compute per-day averages
  const avgByDow = Array.from({ length: 7 }, (_, d) => {
    const occ = occurrences[d] || 1
    const byMode: Record<string, number> = {}
    for (const m of MODES) byMode[m.id] = (rawByDow[d][m.id] || 0) / occ
    const total = Object.values(byMode).reduce((a, b) => a + b, 0)
    return { byMode, total }
  })

  const maxTotal = Math.max(...avgByDow.map(d => d.total), 1)

  const BAR_H = 120
  const BAR_W = 40
  const PAD_L = 8
  const W = 7 * (BAR_W + PAD_L * 2)

  return (
    <Section
      title="Day-of-Week Fingerprint"
      subtitle="Average activity per weekday · stacked by work mode"
    >
      <svg viewBox={`0 0 ${W} ${BAR_H + 36}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ height: BAR_H + 36 }}>
        {avgByDow.map(({ byMode, total }, d) => {
          const barPx = (total / maxTotal) * BAR_H
          const cx = d * (BAR_W + PAD_L * 2) + PAD_L
          let yOffset = BAR_H - barPx  // start drawing from top of bar

          return (
            <g key={d}>
              {MODES.map(m => {
                const segH = total > 0 ? (byMode[m.id] / total) * barPx : 0
                const rect = segH > 0.5 ? (
                  <rect key={m.id} x={cx} y={yOffset} width={BAR_W} height={segH} fill={m.color} />
                ) : null
                yOffset += segH
                return rect
              })}
              <text x={cx + BAR_W / 2} y={BAR_H + 14} textAnchor="middle" fontSize={10} fill="#78716c">{DOW_LABELS[d]}</text>
              <text x={cx + BAR_W / 2} y={BAR_H + 26} textAnchor="middle" fontSize={9} fill="#a8a29e">{total.toFixed(1)}</text>
            </g>
          )
        })}
      </svg>
      {/* Mode legend */}
      <div className="flex items-center gap-4 flex-wrap mt-1">
        {MODES.map(m => (
          <div key={m.id} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: m.color }} />
            <span className="text-xs text-stone-500">{m.label}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Daily volume bar chart ───────────────────────────────────────────────────

function DailyVolumeChart({ series }: { series: DaySeries[] }) {
  const SURFACES = Object.keys(SURFACE_META).filter(s => series.some(d => (d.by_surface[s] || 0) > 0))
  const max  = Math.max(...series.map(d => d.total), 1)
  const H    = 100
  const barW = 8
  const gap  = 2
  const totalW = series.length * (barW + gap)

  return (
    <div className="w-full overflow-x-hidden">
      <svg viewBox={`0 0 ${totalW} ${H}`} className="w-full" style={{ height: 112 }} preserveAspectRatio="none">
        {series.map((day, i) => {
          let y = H
          const x = i * (barW + gap)
          return (
            <g key={day.date}>
              {SURFACES.map(s => {
                const c = day.by_surface[s] || 0
                if (!c) return null
                const bh = (c / max) * H
                y -= bh
                return (
                  <rect key={s} x={x} y={y} width={barW} height={bh} fill={SURFACE_META[s].color} rx={1}>
                    <title>{day.date} · {SURFACE_META[s].label}: {c}</title>
                  </rect>
                )
              })}
              {day.total === 0 && <rect x={x} y={H - 2} width={barW} height={2} fill="#e7e0d8" rx={1} />}
            </g>
          )
        })}
      </svg>
      <div className="flex text-xs text-stone-400 mt-1" style={{ minWidth: series.length * 6 }}>
        {series.map((day, i) => {
          const show = i === 0 || i % 7 === 0 || i === series.length - 1
          return (
            <div key={day.date} className="flex-1 text-center" style={{ fontSize: 9 }}>
              {show ? fmtDate(day.date) : ''}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Weekly rhythm ────────────────────────────────────────────────────────────

function WeeklyChart({ weekly }: { weekly: WeekSeries[] }) {
  const SURFACES = Object.keys(SURFACE_META).filter(s => weekly.some(w => (w.by_surface[s] || 0) > 0))
  const last16 = weekly.slice(-16)
  const max = Math.max(...last16.map(w => w.total), 1)

  const H = 80
  const LABEL_H = 16
  const BAR_GAP = 3
  const n = last16.length
  const W = 560
  const barW = n > 0 ? Math.max(4, (W - BAR_GAP * (n - 1)) / n) : 20

  return (
    <svg viewBox={`0 0 ${W} ${H + LABEL_H}`} className="w-full" preserveAspectRatio="none" style={{ height: H + LABEL_H }}>
      {last16.map((w, i) => {
        const barH = Math.max((w.total / max) * H, w.total > 0 ? 2 : 0)
        const x = i * (barW + BAR_GAP)
        let yOff = H - barH

        return (
          <g key={w.week}>
            {SURFACES.map(s => {
              const c = w.by_surface[s] || 0
              if (!c || !barH) return null
              const segH = (c / w.total) * barH
              const rect = <rect key={s} x={x} y={yOff} width={barW} height={segH} fill={SURFACE_META[s].color} rx={1}>
                <title>{`Week of ${fmtDate(w.week)} · ${SURFACE_META[s].label}: ${c}`}</title>
              </rect>
              yOff += segH
              return rect
            })}
            {(i === 0 || i % 2 === 0) && (
              <text x={x + barW / 2} y={H + LABEL_H - 2} textAnchor="middle" fontSize={8} fill="#a8a29e">
                {fmtDate(w.week)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Project heatmap ──────────────────────────────────────────────────────────

function ProjectHeatmap({ projects, projectDaily, dates }: {
  projects: ManifestProject[]
  projectDaily: Record<string, Record<string, number>>
  dates: string[]
}) {
  const active = projects.filter(p => {
    const pd = projectDaily[p.id]
    return pd && Object.keys(pd).length > 0
  }).sort((a, b) => a.priority - b.priority)

  const allCounts = active.flatMap(p => Object.values(projectDaily[p.id] || {}))
  const globalMax = Math.max(...allCounts, 1)
  const CELL = 12, GAP = 2

  const monthLabels: { date: string; label: string; col: number }[] = []
  dates.forEach((date, i) => {
    const d = new Date(date + 'T12:00:00Z')
    if (d.getUTCDate() === 1 || i === 0) {
      monthLabels.push({ date, label: d.toLocaleDateString('en-US', { month: 'short' }), col: i })
    }
  })

  return (
    <div className="overflow-x-auto">
      <div className="flex mb-1 ml-32" style={{ gap: GAP }}>
        {dates.map((date, i) => {
          const ml = monthLabels.find(m => m.col === i)
          return (
            <div key={date} style={{ width: CELL, flexShrink: 0, fontSize: 9 }} className="text-stone-400 overflow-visible whitespace-nowrap">
              {ml ? ml.label : ''}
            </div>
          )
        })}
      </div>
      <div className="space-y-1">
        {active.map(proj => {
          const pd = projectDaily[proj.id] || {}
          const portColor = PORTFOLIO_COLOR[proj.portfolio] ?? '#78716c'
          return (
            <div key={proj.id} className="flex items-center gap-2">
              <div className="w-32 shrink-0 text-right">
                <span className="text-xs text-stone-600 font-medium truncate block">{proj.id}</span>
              </div>
              <div className="flex" style={{ gap: GAP }}>
                {dates.map(date => {
                  const count     = pd[date] || 0
                  const intensity = count > 0 ? Math.min(0.15 + (count / Math.min(globalMax, 15)) * 0.85, 1) : 0
                  return (
                    <Tip key={date} label={count > 0 ? `${proj.id} · ${fmtDate(date)}: ${count} event${count !== 1 ? 's' : ''}` : `${proj.id} · ${fmtDate(date)}: no activity`}>
                      <div style={{
                        width: CELL, height: CELL, borderRadius: 2, flexShrink: 0,
                        backgroundColor: count > 0 ? `rgba(${hexToRgb(portColor)}, ${intensity})` : '#ede8df',
                      }} />
                    </Tip>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Type breakdown bar ───────────────────────────────────────────────────────

function TypeBreakdown({ byType }: { byType: Record<string, number> }) {
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1])
  const total   = entries.reduce((s, [, c]) => s + c, 0)
  if (!total) return null
  return (
    <div className="space-y-2">
      {entries.map(([type, count]) => {
        const color = TYPE_META[type]?.color ?? '#a8a29e'
        const pct   = Math.round((count / total) * 100)
        return (
          <div key={type} className="flex items-center gap-2">
            <span className="text-xs text-stone-500 w-16 shrink-0">{type}</span>
            <div className="flex-1 bg-stone-100 h-2 overflow-hidden">
              <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="text-xs text-stone-400 tabular-nums w-8 text-right">{count}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData]       = useState<TimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays]       = useState(60)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/timeline?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  const mostActiveSurface = data
    ? Object.entries(data.summary.by_surface).sort((a, b) => b[1] - a[1])[0]
    : null

  const mostActiveProject = data
    ? Object.entries(
        data.daily_series.reduce((acc, day) => {
          for (const [p, c] of Object.entries(day.by_project)) acc[p] = (acc[p] || 0) + c
          return acc
        }, {} as Record<string, number>)
      ).sort((a, b) => b[1] - a[1])[0]
    : null

  const activeProjectCount = data
    ? Object.keys(
        data.daily_series.reduce((acc, day) => {
          for (const p of Object.keys(day.by_project)) acc[p] = 1
          return acc
        }, {} as Record<string, number>)
      ).filter(p => p !== 'unsorted').length
    : 0

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#f5f0e8' }}>
      <Nav />

      <main className="flex-1 p-5 space-y-5 max-w-[1400px] mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-stone-800">Activity Dashboard</h1>
            <p className="text-xs text-stone-400 mt-0.5">All surfaces · all projects</p>
          </div>
          <div className="flex items-center gap-1 bg-white border border-stone-200 p-1 shadow-sm">
            {[{ label: '30d', value: 30 }, { label: '60d', value: 60 }, { label: '90d', value: 90 }].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setDays(value)}
                className={clsx(
                  'text-xs px-3 py-1 font-medium transition-colors',
                  days === value ? 'bg-amber-700 text-white' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-64">
            <span className="text-sm text-stone-400 animate-pulse">Loading timeline…</span>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total events" value={data.summary.total.toLocaleString()} sub={`${days}-day period`} />
              <StatCard label="Daily average" value={data.daily_avg} sub="events per day" color="#92400e" />
              <StatCard
                label="Top surface"
                value={mostActiveSurface ? (SURFACE_META[mostActiveSurface[0]]?.label ?? mostActiveSurface[0]) : '—'}
                sub={mostActiveSurface ? `${mostActiveSurface[1].toLocaleString()} events` : undefined}
                color={mostActiveSurface ? SURFACE_META[mostActiveSurface[0]]?.color : undefined}
              />
              <StatCard
                label="Active projects"
                value={activeProjectCount}
                sub={mostActiveProject ? `most active: ${mostActiveProject[0]}` : undefined}
                color="#0f766e"
              />
            </div>

            {/* Volume + type breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <Section
                  title="Daily Event Volume"
                  subtitle={`${days} days · stacked by surface`}
                  action={
                    <div className="flex items-center gap-3 flex-wrap">
                      {Object.entries(SURFACE_META).filter(([s]) => data.daily_series.some(d => (d.by_surface[s] || 0) > 0)).map(([s, m]) => (
                        <div key={s} className="flex items-center gap-1">
                          <span className="w-2 h-2" style={{ backgroundColor: m.color }} />
                          <span className="text-xs text-stone-400">{m.label}</span>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <DailyVolumeChart series={data.daily_series} />
                </Section>
              </div>
              <Section title="Type Breakdown" subtitle="events by kind, all time">
                <TypeBreakdown byType={data.summary.by_type} />
              </Section>
            </div>

            {/* Work Patterns — the behavioural overlay */}
            <WorkPatternChart series={data.daily_series} dates={data.all_dates} />

            {/* Surface overlay */}
            <SurfaceOverlayChart series={data.daily_series} dates={data.all_dates} />

            {/* Type overlay */}
            <TypeOverlayChart series={data.daily_series} dates={data.all_dates} />

            {/* Day-of-week fingerprint */}
            <DayOfWeekChart series={data.daily_series} />

            {/* Weekly rhythm */}
            <Section title="Weekly Rhythm" subtitle={`last ${Math.min(data.weekly_series.length, 16)} weeks`}>
              <WeeklyChart weekly={data.weekly_series} />
            </Section>

            {/* Project heatmap */}
            <Section
              title="Project Activity Heatmap"
              subtitle="each cell = one day · color intensity = event count"
            >
              <div className="mb-3 flex flex-wrap gap-3">
                {Object.entries(PORTFOLIO_COLOR).map(([p, c]) => (
                  <div key={p} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5" style={{ backgroundColor: c }} />
                    <span className="text-xs text-stone-500">{p}</span>
                  </div>
                ))}
              </div>
              <ProjectHeatmap projects={data.projects} projectDaily={data.project_daily} dates={data.all_dates} />
            </Section>
          </>
        )}
      </main>
    </div>
  )
}
