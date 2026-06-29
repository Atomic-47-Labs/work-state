import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const WORK_STATE = path.join(process.env.HOME!, 'work-state')

interface DayBucket {
  total: number
  by_surface: Record<string, number>
  by_type: Record<string, number>
  by_project: Record<string, number>
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') || '60')

  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)

  // Build the full list of dates in range (including zero-count days)
  const allDates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    allDates.push(d.toISOString().split('T')[0])
  }

  // Walk events directory
  const daily: Record<string, DayBucket> = {}
  const eventsDir = path.join(WORK_STATE, 'events')

  if (fs.existsSync(eventsDir)) {
    const dateDirs = fs.readdirSync(eventsDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()

    for (const dateDir of dateDirs) {
      if (new Date(dateDir + 'T00:00:00Z') < cutoff) continue

      if (!daily[dateDir]) {
        daily[dateDir] = { total: 0, by_surface: {}, by_type: {}, by_project: {} }
      }

      const dayPath = path.join(eventsDir, dateDir)
      let files: string[]
      try {
        files = fs.readdirSync(dayPath).filter(f => f.endsWith('.json'))
      } catch {
        continue
      }

      const bucket = daily[dateDir]
      for (const file of files) {
        try {
          const ev = JSON.parse(fs.readFileSync(path.join(dayPath, file), 'utf-8'))
          bucket.total++
          bucket.by_surface[ev.surface] = (bucket.by_surface[ev.surface] || 0) + 1
          bucket.by_type[ev.type]       = (bucket.by_type[ev.type]       || 0) + 1
          const proj = ev.project || 'unsorted'
          bucket.by_project[proj]       = (bucket.by_project[proj]       || 0) + 1
        } catch {}
      }
    }
  }

  const empty = (): DayBucket => ({ total: 0, by_surface: {}, by_type: {}, by_project: {} })
  const daily_series = allDates.map(date => ({ date, ...(daily[date] || empty()) }))

  // project_daily: project -> date -> count (sparse)
  const project_daily: Record<string, Record<string, number>> = {}
  for (const [date, bucket] of Object.entries(daily)) {
    for (const [proj, count] of Object.entries(bucket.by_project)) {
      if (!project_daily[proj]) project_daily[proj] = {}
      project_daily[proj][date] = count
    }
  }

  // weekly_series: bucket days into calendar weeks (Mon–Sun)
  const weekBuckets: Record<string, { week: string; total: number; by_surface: Record<string, number>; by_type: Record<string, number> }> = {}
  for (const day of daily_series) {
    const d = new Date(day.date + 'T12:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7  // Mon=0
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - dow)
    const weekKey = monday.toISOString().split('T')[0]

    if (!weekBuckets[weekKey]) {
      weekBuckets[weekKey] = { week: weekKey, total: 0, by_surface: {}, by_type: {} }
    }
    const wb = weekBuckets[weekKey]
    wb.total += day.total
    for (const [s, c] of Object.entries(day.by_surface)) {
      wb.by_surface[s] = (wb.by_surface[s] || 0) + c
    }
    for (const [t, c] of Object.entries(day.by_type)) {
      wb.by_type[t] = (wb.by_type[t] || 0) + c
    }
  }
  const weekly_series = Object.values(weekBuckets).sort((a, b) => a.week.localeCompare(b.week))

  // Period summary
  const summary = { total: 0, by_surface: {} as Record<string, number>, by_type: {} as Record<string, number> }
  for (const day of daily_series) {
    summary.total += day.total
    for (const [s, c] of Object.entries(day.by_surface)) summary.by_surface[s] = (summary.by_surface[s] || 0) + c
    for (const [t, c] of Object.entries(day.by_type)) summary.by_type[t] = (summary.by_type[t] || 0) + c
  }

  const daily_avg = summary.total / days

  // Project list from manifest
  const manifestRaw = fs.readFileSync(path.join(WORK_STATE, 'manifest.yaml'), 'utf-8')
  const manifest = yaml.load(manifestRaw) as { projects: Array<{ id: string; portfolio: string; status: string; priority: number }> }

  return NextResponse.json({
    daily_series,
    project_daily,
    weekly_series,
    summary,
    daily_avg: Math.round(daily_avg * 10) / 10,
    projects: manifest.projects,
    all_dates: allDates,
    days,
  })
}
