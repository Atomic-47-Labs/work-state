import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const WORK_STATE = path.join(process.env.HOME!, 'work-state')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project')
  const days = parseInt(searchParams.get('days') || '30')
  const limit = parseInt(searchParams.get('limit') || '60')

  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)

  const eventsDir = path.join(WORK_STATE, 'events')
  const results: unknown[] = []

  if (fs.existsSync(eventsDir)) {
    const dateDirs = fs.readdirSync(eventsDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse()

    outer: for (const dateDir of dateDirs) {
      if (new Date(dateDir + 'T00:00:00Z') < cutoff) break

      const dayPath = path.join(eventsDir, dateDir)
      let files: string[]
      try {
        files = fs.readdirSync(dayPath).filter(f => f.endsWith('.json'))
      } catch {
        continue
      }

      for (const file of files) {
        try {
          const event = JSON.parse(fs.readFileSync(path.join(dayPath, file), 'utf-8'))
          if (!projectId || event.project === projectId) {
            results.push(event)
            if (results.length >= limit * 3) break outer // over-fetch then sort+slice
          }
        } catch {}
      }
    }
  }

  const sorted = (results as Array<{ timestamp: string }>).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return NextResponse.json({ events: sorted.slice(0, limit) })
}
