import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const WORK_STATE   = path.join(process.env.HOME!, 'work-state')
const MANIFEST     = path.join(WORK_STATE, 'manifest.yaml')

// ─── PATCH /api/projects/[id] ─────────────────────────────────────────────────
// Body: { portfolio: string }
//   → updates the project's portfolio in manifest.yaml

type ManifestProject = {
  id: string
  portfolio: string
  surfaces?: { github?: { repos?: string[] } }
  [k: string]: unknown
}

type Manifest = { projects: ManifestProject[] }

function readManifest(): Manifest {
  return yaml.load(fs.readFileSync(MANIFEST, 'utf-8')) as Manifest
}

function writeManifest(manifest: Manifest) {
  fs.writeFileSync(MANIFEST, yaml.dump(manifest, { lineWidth: 120, noRefs: true, forceQuotes: false }), 'utf-8')
}

// ─── PATCH /api/projects/[id] ─────────────────────────────────────────────────
// Supported actions (body):
//   { portfolio: string }         → move project to a different portfolio
//   { addRepo: string }           → append a repo to surfaces.github.repos

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  try {
    const manifest = readManifest()
    const project  = manifest.projects.find(p => p.id === id)
    if (!project) return NextResponse.json({ error: `Project "${id}" not found` }, { status: 404 })

    // ── Move to portfolio ──────────────────────────────────────────────
    if ('portfolio' in body) {
      const { portfolio } = body as { portfolio: string }
      const from = project.portfolio
      if (from === portfolio) return NextResponse.json({ ok: true, changed: false })
      project.portfolio = portfolio
      writeManifest(manifest)
      return NextResponse.json({ ok: true, changed: true, action: 'move-portfolio', id, from, to: portfolio })
    }

    // ── Add repo ───────────────────────────────────────────────────────
    if ('addRepo' in body) {
      const { addRepo } = body as { addRepo: string }
      if (!project.surfaces) project.surfaces = {}
      if (!project.surfaces.github) project.surfaces.github = {}
      if (!project.surfaces.github.repos) project.surfaces.github.repos = []
      if (project.surfaces.github.repos.includes(addRepo)) {
        return NextResponse.json({ ok: true, changed: false, note: 'repo already bound' })
      }
      project.surfaces.github.repos.push(addRepo)
      writeManifest(manifest)
      return NextResponse.json({ ok: true, changed: true, action: 'add-repo', id, repo: addRepo })
    }

    // ── Remove repo ────────────────────────────────────────────────────
    if ('removeRepo' in body) {
      const { removeRepo } = body as { removeRepo: string }
      const repos = project.surfaces?.github?.repos ?? []
      if (!repos.includes(removeRepo)) {
        return NextResponse.json({ ok: true, changed: false, note: 'repo not bound' })
      }
      project.surfaces!.github!.repos = repos.filter(r => r !== removeRepo)
      writeManifest(manifest)
      return NextResponse.json({ ok: true, changed: true, action: 'remove-repo', id, repo: removeRepo })
    }

    return NextResponse.json({ error: 'no valid action in body' }, { status: 400 })
  } catch (err) {
    console.error('[PATCH /api/projects/[id]]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ─── POST /api/projects/[id] ──────────────────────────────────────────────────
// Body: { name, portfolio, repo }
//   → creates a new project stub from an untracked repo and adds it to manifest

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const { name, portfolio, repo } = body as { name?: string; portfolio?: string; repo?: string }

  if (!portfolio) return NextResponse.json({ error: 'portfolio is required' }, { status: 400 })
  if (!repo)      return NextResponse.json({ error: 'repo is required' }, { status: 400 })

  try {
    const raw      = fs.readFileSync(MANIFEST, 'utf-8')
    const manifest = yaml.load(raw) as { projects: { id: string; portfolio: string; priority: number; status: string; surfaces?: { github?: { repos?: string[] } }; [k: string]: unknown }[] }

    if (manifest.projects.find(p => p.id === id)) {
      return NextResponse.json({ error: `Project "${id}" already exists` }, { status: 409 })
    }

    const stub = {
      id,
      name: name || id,
      portfolio,
      status: 'active',
      priority: 5,
      surfaces: { github: { repos: [repo] } },
    }

    manifest.projects.push(stub)

    const updated = yaml.dump(manifest, {
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    })
    fs.writeFileSync(MANIFEST, updated, 'utf-8')

    return NextResponse.json({ ok: true, project: stub })
  } catch (err) {
    console.error('[POST /api/projects/[id]]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
