import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { listEventDates, readDayEvents } from '@/lib/events'

const WORK_STATE = path.join(process.env.HOME!, 'work-state')

// ─── Raw event shapes ─────────────────────────────────────────────────────────

interface BuildEvidence {
  session_id: string
  cwd: string
  git_branch: string
  started_at: string
  ended_at: string
  duration_seconds: number | null
  user_turns: number
  assistant_turns: number
  tool_calls: Record<string, number>
  tool_calls_total: number
  files_touched: string[]
  bash_commands_count: number
  subagent_invocations: number
  cache_read_tokens: number
  cache_creation_tokens: number
  summary: string | null
  session_status?: string
}

interface BuildMetrics {
  session_minutes: number
  tools_per_minute: number
  session_size_class: string
  agentic_ratio: number
}

interface BuildEvent {
  id: string; type: 'build'; timestamp: string; project: string
  evidence: BuildEvidence; metrics: BuildMetrics
}

interface BurstEvidence {
  session_id: string; burst_start: string; burst_end: string
  burst_duration_seconds: number; tool_calls: Record<string, number>
  tool_calls_total: number; dominant_tool: string; files_touched: string[]
  git_branch: string; preceding_idle_seconds: number | null
}
interface BurstMetrics { burst_intensity: number; burst_size_class: string }
interface BurstEvent {
  id: string; type: 'tool-burst'; timestamp: string; project: string
  evidence: BurstEvidence; metrics: BurstMetrics
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateOf(iso: string) { return iso.slice(0, 10) }
function hourOf(iso: string) { return new Date(iso).getUTCHours() }
function dowOf(iso: string)  { return new Date(iso).getUTCDay() }
function weekOf(iso: string) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

function readAllEvents(): { builds: BuildEvent[]; bursts: BurstEvent[] } {
  const eventsDir = path.join(WORK_STATE, 'events')
  const builds: BuildEvent[] = [], bursts: BurstEvent[] = []

  for (const dateDir of listEventDates(eventsDir)) {
    for (const ev of readDayEvents<{ surface?: string; type?: string }>(eventsDir, dateDir)) {
      if (ev.surface !== 'claude-code') continue
      if (ev.type === 'build') builds.push(ev as unknown as BuildEvent)
      else if (ev.type === 'tool-burst') bursts.push(ev as unknown as BurstEvent)
    }
  }
  return { builds, bursts }
}

// ─── Core aggregation ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const daysParam = searchParams.get('days') ?? '30'
  const days = daysParam === 'all' ? null : parseInt(daysParam)

  const { builds: allBuilds, bursts: allBursts } = readAllEvents()
  if (allBuilds.length === 0) return NextResponse.json({ empty: true })

  // Dates for windowing
  const now = new Date(); now.setUTCHours(23, 59, 59, 999)
  const windowStart = days ? new Date(now.getTime() - days * 86400000) : null
  const prevStart   = days ? new Date(now.getTime() - days * 2 * 86400000) : null
  const winStr  = windowStart?.toISOString().slice(0, 10) ?? '0000-01-01'
  const prevStr = prevStart?.toISOString().slice(0, 10) ?? '0000-01-01'

  const builds = days ? allBuilds.filter(b => b.timestamp >= winStr) : allBuilds
  const bursts = days ? allBursts.filter(b => b.timestamp >= winStr) : allBursts
  const prevBuilds = days ? allBuilds.filter(b => b.timestamp >= prevStr && b.timestamp < winStr) : []
  const prevBursts = days ? allBursts.filter(b => b.timestamp >= prevStr && b.timestamp < winStr) : []

  // ── All-time aggregates (always full corpus) ───────────────────────────────
  const allActiveDays = new Set(allBuilds.map(b => dateOf(b.timestamp)))
  const allProjects   = new Set(allBuilds.filter(b => b.project !== 'unsorted').map(b => b.project))
  let atTools = 0, atSubagents = 0, atCacheRead = 0, atCacheCreate = 0
  const atFiles = new Set<string>()
  for (const b of allBuilds) {
    atTools += b.evidence.tool_calls_total
    atSubagents += b.evidence.subagent_invocations || 0
    atCacheRead += b.evidence.cache_read_tokens || 0
    atCacheCreate += b.evidence.cache_creation_tokens || 0
    for (const f of b.evidence.files_touched || []) atFiles.add(f)
  }

  // ── Window aggregates ──────────────────────────────────────────────────────
  const winActiveDays = new Set(builds.map(b => dateOf(b.timestamp)))
  let winTools = 0, winSubagents = 0, winCacheRead = 0, winCacheCreate = 0
  const winSizeCounts: Record<string, number> = { trivial: 0, quick: 0, focused: 0, deep: 0, marathon: 0 }
  const winToolCounts: Record<string, number> = {}

  for (const b of builds) {
    winTools += b.evidence.tool_calls_total
    winSubagents += b.evidence.subagent_invocations || 0
    winCacheRead += b.evidence.cache_read_tokens || 0
    winCacheCreate += b.evidence.cache_creation_tokens || 0
    const sc = b.metrics?.session_size_class ?? 'quick'
    winSizeCounts[sc] = (winSizeCounts[sc] || 0) + 1
    for (const [t, c] of Object.entries(b.evidence.tool_calls || {}))
      winToolCounts[t] = (winToolCounts[t] || 0) + c
  }

  const prevStats = {
    sessions: prevBuilds.length,
    tools: prevBuilds.reduce((s, b) => s + b.evidence.tool_calls_total, 0),
    bursts: prevBursts.length,
  }

  // ── Daily series (window) ──────────────────────────────────────────────────
  const dailyMap: Record<string, {
    sessions: number; tools: number; bursts: number
    tool_mix: Record<string, number>; avg_agentic: number; _agentic_sum: number
  }> = {}

  for (const b of builds) {
    const d = dateOf(b.timestamp)
    if (!dailyMap[d]) dailyMap[d] = { sessions: 0, tools: 0, bursts: 0, tool_mix: {}, avg_agentic: 0, _agentic_sum: 0 }
    dailyMap[d].sessions++
    dailyMap[d].tools += b.evidence.tool_calls_total
    dailyMap[d]._agentic_sum += b.metrics?.agentic_ratio || 0
    for (const [t, c] of Object.entries(b.evidence.tool_calls || {}))
      dailyMap[d].tool_mix[t] = (dailyMap[d].tool_mix[t] || 0) + c
  }
  for (const bst of bursts) {
    const d = dateOf(bst.timestamp)
    if (!dailyMap[d]) dailyMap[d] = { sessions: 0, tools: 0, bursts: 0, tool_mix: {}, avg_agentic: 0, _agentic_sum: 0 }
    dailyMap[d].bursts++
  }
  for (const v of Object.values(dailyMap))
    v.avg_agentic = v.sessions > 0 ? Math.round((v._agentic_sum / v.sessions) * 10) / 10 : 0

  const daily = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
    date, sessions: v.sessions, tools: v.tools, bursts: v.bursts,
    tool_mix: v.tool_mix, avg_agentic: v.avg_agentic,
  }))

  // ── Weekly series ──────────────────────────────────────────────────────────
  const weeklyMap: Record<string, { sessions: number; tools: number; bursts: number }> = {}
  for (const b of builds) {
    const wk = weekOf(dateOf(b.timestamp))
    if (!weeklyMap[wk]) weeklyMap[wk] = { sessions: 0, tools: 0, bursts: 0 }
    weeklyMap[wk].sessions++; weeklyMap[wk].tools += b.evidence.tool_calls_total
  }
  for (const bst of bursts) {
    const wk = weekOf(dateOf(bst.timestamp))
    if (!weeklyMap[wk]) weeklyMap[wk] = { sessions: 0, tools: 0, bursts: 0 }
    weeklyMap[wk].bursts++
  }
  const weekly = Object.entries(weeklyMap).sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, ...v }))

  // ── Session scatter (duration vs tools, for character chart) ───────────────
  const sessionScatter = builds
    .filter(b => b.metrics?.session_minutes != null && b.evidence.tool_calls_total > 0)
    .map(b => ({
      duration_min: b.metrics.session_minutes,
      tool_calls: b.evidence.tool_calls_total,
      size_class: b.metrics.session_size_class,
      project: b.project,
      date: dateOf(b.timestamp),
      agentic_ratio: b.metrics.agentic_ratio,
      subagents: b.evidence.subagent_invocations || 0,
    }))

  // ── Project daily (for project timeline heatmap) ───────────────────────────
  const projectDailyMap: Record<string, Record<string, number>> = {}
  for (const b of builds) {
    const p = b.project || 'unsorted'
    if (!projectDailyMap[p]) projectDailyMap[p] = {}
    const d = dateOf(b.timestamp)
    projectDailyMap[p][d] = (projectDailyMap[p][d] || 0) + 1
  }

  // ── Hour × DOW matrix (7×24) ───────────────────────────────────────────────
  const hourDowMatrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const b of builds) {
    const ts = b.evidence.started_at || b.timestamp
    hourDowMatrix[dowOf(ts)][hourOf(ts)]++
  }

  // ── Project velocity ───────────────────────────────────────────────────────
  const projMap: Record<string, { sessions: number; tools: number; bursts: number; last_active: string }> = {}
  for (const b of builds) {
    const p = b.project || 'unsorted'
    if (!projMap[p]) projMap[p] = { sessions: 0, tools: 0, bursts: 0, last_active: b.timestamp }
    projMap[p].sessions++; projMap[p].tools += b.evidence.tool_calls_total
    if (b.timestamp > projMap[p].last_active) projMap[p].last_active = b.timestamp
  }
  for (const bst of bursts) {
    const p = bst.project || 'unsorted'
    if (projMap[p]) projMap[p].bursts++
  }
  const topProjects = Object.entries(projMap)
    .sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 12)
    .map(([id, v]) => ({ id, ...v }))

  // ── Branch activity ────────────────────────────────────────────────────────
  const branchMap: Record<string, number> = {}
  for (const b of builds) {
    const br = b.evidence.git_branch || 'unknown'
    branchMap[br] = (branchMap[br] || 0) + 1
  }
  const branchActivity = Object.entries(branchMap).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([branch, sessions]) => ({ branch, sessions }))

  // ── Top files ──────────────────────────────────────────────────────────────
  const fileMap: Record<string, number> = {}
  for (const b of builds)
    for (const f of b.evidence.files_touched || []) fileMap[f] = (fileMap[f] || 0) + 1
  const topFiles = Object.entries(fileMap).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([filePath, count]) => ({ path: filePath, count }))

  // ── Agentic stats ──────────────────────────────────────────────────────────
  const sessionsWithSubagents = builds.filter(b => (b.evidence.subagent_invocations || 0) > 0).length
  const agRatios = builds.map(b => b.metrics?.agentic_ratio || 0).filter(r => r > 0)
  const avgAgRatio = agRatios.length ? agRatios.reduce((a, b) => a + b, 0) / agRatios.length : 0
  const tpmVals   = builds.map(b => b.metrics?.tools_per_minute || 0).filter(r => r > 0)
  const avgTpm    = tpmVals.length ? tpmVals.reduce((a, b) => a + b, 0) / tpmVals.length : 0

  // ── Burst aggregates ───────────────────────────────────────────────────────
  const burstSizeClasses: Record<string, number> = { compact: 0, intense: 0, sustained: 0 }
  const burstDomTools: Record<string, number> = {}
  let burstIntSum = 0, burstDurSum = 0
  for (const bst of bursts) {
    const sc = bst.metrics?.burst_size_class ?? 'compact'
    burstSizeClasses[sc] = (burstSizeClasses[sc] || 0) + 1
    const dt = bst.evidence.dominant_tool
    if (dt) burstDomTools[dt] = (burstDomTools[dt] || 0) + 1
    burstIntSum += bst.metrics?.burst_intensity || 0
    burstDurSum += bst.evidence.burst_duration_seconds || 0
  }

  // ── Duration stats ─────────────────────────────────────────────────────────
  const durations = builds.map(b => b.metrics?.session_minutes || 0).filter(d => d > 0).sort((a, b) => a - b)
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
  const p50Dur = durations.length ? durations[Math.floor(durations.length * 0.5)] : 0
  const p95Dur = durations.length ? durations[Math.floor(durations.length * 0.95)] : 0

  // ── 52-week heatmap (always full year regardless of window) ───────────────
  const heatmapMap: Record<string, { sessions: number; tools: number }> = {}
  const yearAgoStr = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  for (const b of allBuilds) {
    if (b.timestamp < yearAgoStr) continue
    const d = dateOf(b.timestamp)
    if (!heatmapMap[d]) heatmapMap[d] = { sessions: 0, tools: 0 }
    heatmapMap[d].sessions++; heatmapMap[d].tools += b.evidence.tool_calls_total
  }
  const heatmap = Object.entries(heatmapMap).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

  // ── Today / yesterday snapshots ────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10)
  const yestStr  = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  function snapshot(ds: string) {
    const bs = allBuilds.filter(b => dateOf(b.timestamp) === ds)
    const bst = allBursts.filter(b => dateOf(b.timestamp) === ds)
    const projs = [...new Set(bs.map(b => b.project))]
    const branches = [...new Set(bs.map(b => b.evidence.git_branch).filter(Boolean))]
    return {
      sessions: bs.length,
      tools: bs.reduce((s, b) => s + b.evidence.tool_calls_total, 0),
      bursts: bst.length,
      projects: projs,
      branches,
    }
  }

  return NextResponse.json({
    window: { days: days ?? 'all', start: winStr },
    all_time: {
      sessions: allBuilds.length, total_tools: atTools,
      active_days: allActiveDays.size, projects: allProjects.size,
      total_bursts: allBursts.length, subagent_invocations: atSubagents,
      cache_read_tokens: atCacheRead, cache_creation_tokens: atCacheCreate,
      files_unique: atFiles.size,
    },
    window_stats: {
      sessions: builds.length, tools: winTools, bursts: bursts.length,
      active_days: winActiveDays.size,
      cache_read: winCacheRead, cache_create: winCacheCreate,
    },
    prev_stats: prevStats,
    daily, weekly,
    session_scatter: sessionScatter,
    project_daily: projectDailyMap,
    hour_dow_matrix: hourDowMatrix,
    size_classes: winSizeCounts,
    tool_counts: winToolCounts,
    burst_stats: {
      count: bursts.length,
      avg_intensity: bursts.length ? burstIntSum / bursts.length : 0,
      avg_duration_seconds: bursts.length ? burstDurSum / bursts.length : 0,
      dominant_tools: burstDomTools,
      size_classes: burstSizeClasses,
    },
    top_projects: topProjects,
    branch_activity: branchActivity,
    top_files: topFiles,
    agentic: {
      total_subagent_invocations: winSubagents,
      sessions_with_subagents: sessionsWithSubagents,
      sessions_total: builds.length,
      avg_agentic_ratio: Math.round(avgAgRatio * 10) / 10,
      avg_tools_per_minute: Math.round(avgTpm * 10) / 10,
    },
    cache: {
      read_tokens: winCacheRead, creation_tokens: winCacheCreate,
      hit_rate_pct: winCacheRead + winCacheCreate > 0
        ? Math.round((winCacheRead / (winCacheRead + winCacheCreate)) * 100) : 0,
    },
    duration: { avg: Math.round(avgDur * 10) / 10, p50: Math.round(p50Dur * 10) / 10, p95: Math.round(p95Dur * 10) / 10 },
    heatmap,
    today: snapshot(todayStr),
    yesterday: snapshot(yestStr),
  })
}
