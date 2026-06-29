import fs from 'fs'
import path from 'path'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * All event dates present on disk, as `YYYY-MM-DD` strings, sorted ascending.
 *
 * A date counts if it has EITHER a per-event directory (`events/YYYY-MM-DD/`)
 * OR an append-only index file (`events/YYYY-MM-DD.jsonl`). Enumerating both
 * means a harvest that only wrote the index is still visible to the UI.
 */
export function listEventDates(eventsDir: string): string[] {
  if (!fs.existsSync(eventsDir)) return []
  const dates = new Set<string>()
  for (const entry of fs.readdirSync(eventsDir)) {
    if (DATE_RE.test(entry)) {
      dates.add(entry) // per-event directory
    } else if (entry.endsWith('.jsonl')) {
      const d = entry.slice(0, -'.jsonl'.length)
      if (DATE_RE.test(d)) dates.add(d) // index file
    }
  }
  return [...dates].sort()
}

/**
 * Events for a single date.
 *
 * Prefers the per-event JSON files in `events/YYYY-MM-DD/` (the source of
 * truth). Falls back to the `events/YYYY-MM-DD.jsonl` index when the directory
 * is absent or empty, so the dashboard stays correct even if a harvest only
 * appended to the index and never fanned out the per-event files.
 *
 * Note: index lines for oversized events (>4 KB) may be truncated to the
 * envelope (id/timestamp/surface/type/project) per the work-state spec, so the
 * per-event directory remains authoritative whenever it exists.
 */
export function readDayEvents<T = unknown>(eventsDir: string, date: string): T[] {
  // Preferred: per-event JSON files.
  const dayPath = path.join(eventsDir, date)
  try {
    const files = fs.readdirSync(dayPath).filter(f => f.endsWith('.json'))
    if (files.length > 0) {
      const out: T[] = []
      for (const f of files) {
        try {
          out.push(JSON.parse(fs.readFileSync(path.join(dayPath, f), 'utf-8')) as T)
        } catch {}
      }
      return out
    }
  } catch {
    // no directory — fall through to the index
  }

  // Fallback: the append-only .jsonl index.
  const idx = path.join(eventsDir, `${date}.jsonl`)
  try {
    const out: T[] = []
    for (const line of fs.readFileSync(idx, 'utf-8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        out.push(JSON.parse(s) as T)
      } catch {}
    }
    return out
  } catch {
    return []
  }
}
