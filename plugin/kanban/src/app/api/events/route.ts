import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { listEventDates, readDayEvents } from '@/lib/events'

const WORK_STATE = path.join(process.env.HOME!, 'work-state')

interface WorkEvent { timestamp: string; project?: string }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project')
  const days = parseInt(searchParams.get('days') || '30')
  const limit = parseInt(searchParams.get('limit') || '60')

  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)

  const eventsDir = path.join(WORK_STATE, 'events')
  const results: WorkEvent[] = []

  const dates = listEventDates(eventsDir).reverse()
  outer: for (const date of dates) {
    if (new Date(date + 'T00:00:00Z') < cutoff) break

    for (const event of readDayEvents<WorkEvent>(eventsDir, date)) {
      if (!projectId || event.project === projectId) {
        results.push(event)
        if (results.length >= limit * 3) break outer // over-fetch then sort+slice
      }
    }
  }

  const sorted = results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return NextResponse.json({ events: sorted.slice(0, limit) })
}
