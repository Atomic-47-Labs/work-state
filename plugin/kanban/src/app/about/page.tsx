import { Nav } from '@/components/nav'

// ─── Style constants ──────────────────────────────────────────────────────────

const SURFACE_PILLS: Record<string, { label: string; pill: string; dot: string; what: string }> = {
  github:       { label: 'GitHub',       pill: 'bg-stone-100 text-stone-600 border border-stone-300',         dot: 'bg-stone-500',   what: 'Commits, PRs, releases — code output evidence' },
  slack:        { label: 'Slack',        pill: 'bg-purple-50 text-purple-700 border border-purple-200',       dot: 'bg-purple-500',  what: 'Messages, DMs, mentions — communication evidence' },
  gmail:        { label: 'Gmail',        pill: 'bg-red-50 text-red-700 border border-red-200',                dot: 'bg-red-500',     what: 'Sent + signal-worthy inbound — correspondence evidence' },
  gdocs:        { label: 'Google Docs',  pill: 'bg-blue-50 text-blue-700 border border-blue-200',            dot: 'bg-blue-500',    what: 'Edits, creates, shares — document evidence' },
  scsiwyg:      { label: 'Scsiwyg',      pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200',   dot: 'bg-emerald-500', what: 'Posts, drafts, newsletters — publishing evidence' },
  'claude-code': { label: 'Claude Code', pill: 'bg-violet-50 text-violet-700 border border-violet-200',      dot: 'bg-violet-500',  what: 'Sessions, tool bursts, agentic depth — build evidence' },
}

const SKILLS = [
  {
    cmd: '/work-state',
    label: 'work-state',
    role: 'Foundation',
    desc: 'The only skill that writes directly to the facility. Reads, validates, and mutates manifest.yaml, state.json, events/, and reports/. All other skills route through it.',
    color: '#92400e',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  {
    cmd: '/work-orchestrator',
    label: 'work-orchestrator',
    role: 'Conductor',
    desc: 'Decides what to run next. Checks cursors, identifies missing digests, dispatches harvesters, sequences daily → weekly → longitudinal routines.',
    color: '#78716c',
    bg: 'bg-stone-50',
    border: 'border-stone-200',
  },
  {
    cmd: '/work-harvester-github',
    label: 'work-harvester-github',
    role: 'Harvester',
    desc: 'Harvest GitHub commits, PRs, and releases via the gh CLI. Classifies by size, extracts file changes, attributes to projects.',
    color: '#44403c',
    bg: 'bg-stone-50',
    border: 'border-stone-200',
  },
  {
    cmd: '/work-harvester-gmail',
    label: 'work-harvester-gmail',
    role: 'Harvester',
    desc: 'Harvest sent email and signal-worthy inbound threads via Gmail MCP. Subject-line classification, project attribution by contact patterns.',
    color: '#dc2626',
    bg: 'bg-red-50',
    border: 'border-red-200',
  },
  {
    cmd: '/work-harvester-slack',
    label: 'work-harvester-slack',
    role: 'Harvester',
    desc: 'Harvest Slack messages and DMs via Slack MCP. Channel-to-project mapping, mention detection, thread context.',
    color: '#9333ea',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
  {
    cmd: '/work-harvester-scsiwyg',
    label: 'work-harvester-scsiwyg',
    role: 'Harvester',
    desc: 'Harvest blog posts, drafts, and newsletter sends across all owned scsiwyg sites. Publish and draft events with audience and reach metadata.',
    color: '#059669',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  {
    cmd: '/work-harvester-gdocs',
    label: 'work-harvester-gdocs',
    role: 'Harvester',
    desc: 'Harvest Google Docs edit sessions, creates, and shares via Google Drive MCP. Document-level activity with title and type classification.',
    color: '#2563eb',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  {
    cmd: '/work-harvester-claude-code',
    label: 'work-harvester-claude-code',
    role: 'Harvester',
    desc: 'Parse ~/.claude/projects/ JSONL session files. Produces build events (one per session) and tool-burst events. Captures tool anatomy, files touched, agentic depth, and cache efficiency.',
    color: '#7c3aed',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  {
    cmd: '/work-kanban',
    label: 'work-kanban',
    role: 'UI',
    desc: 'Start the local Next.js reporting UI at localhost:3333. Kanban, Dashboard, Inventory, Claudash, and About views. Auto-installs on first run from the plugin bundle.',
    color: '#0f766e',
    bg: 'bg-teal-50',
    border: 'border-teal-200',
  },
]

const ECOSYSTEM = [
  {
    name: 'work-state',
    tagline: 'Personal work intelligence',
    desc: 'Evidence of what you built, shipped, and communicated — across all surfaces. Foundation for everything else.',
    accent: '#d97706',
    current: true,
  },
  {
    name: 'project-state',
    tagline: 'Project intelligence',
    desc: 'Milestone tracking, status reports, funder reporting, phase gates, and change registers for specific funded or scoped projects. Companion to work-state.',
    accent: '#0ea5e9',
  },
  {
    name: 'notella',
    tagline: 'Notebook intelligence',
    desc: 'Intake, classify, and synthesize handwritten notebooks and sketches. Turns physical notes into indexed, searchable intelligence.',
    accent: '#e11d48',
  },
  {
    name: 'app-state',
    tagline: 'Product intelligence',
    desc: 'Technical, operational, market, and blog state for any software product. Signal harvesting and idea capture at the repo level.',
    accent: '#8b5cf6',
  },
]

const LAYERS = [
  { label: 'Intelligence', sub: 'longitudinal/ · weekly/ · themes, velocity, trajectory', color: '#d97706', bg: 'bg-amber-50', border: 'border-amber-300', icon: '◈' },
  { label: 'Reports',      sub: 'daily/*.md · weekly/*.md · digests and summaries',       color: '#0891b2', bg: 'bg-sky-50',   border: 'border-sky-300',   icon: '◇' },
  { label: 'Measurement',  sub: 'daily/*.json · counters and metrics',                    color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: '○' },
  { label: 'Evidence',     sub: 'events/YYYY-MM-DD/*.json · immutable, append-only',      color: '#78716c', bg: 'bg-stone-100', border: 'border-stone-300',   icon: '●' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AboutPage() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#f5f0e8' }}>
      <Nav />

      <main className="flex-1 max-w-[1100px] mx-auto w-full px-5 py-8 space-y-14">

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            v1.1.0 · local-first · MIT
          </div>
          <h1 className="text-4xl font-bold text-stone-900 leading-tight">
            Your work, fully<br />
            <span style={{ color: '#d97706' }}>indexed.</span>
          </h1>
          <p className="text-lg text-stone-500 max-w-2xl leading-relaxed">
            work-state is a personal work intelligence facility. It harvests evidence of everything you build,
            ship, and communicate — across GitHub, Slack, Gmail, Google Docs, your blog, and Claude Code sessions
            — into a local, schema-governed data store. Then derives daily digests, weekly reports, and
            longitudinal intelligence from it.
          </p>
          <p className="text-sm text-stone-400 max-w-xl">
            Built for the gap that keeps derailing projects: not missing work, but missing <em>awareness</em> of the work that&apos;s happening.
          </p>
        </div>

        {/* ── The problem ───────────────────────────────────────────────────── */}
        <div className="bg-white border border-stone-200 shadow-sm p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">The gap</div>
              <h2 className="text-2xl font-bold text-stone-800 mb-3">Work is happening. Intelligence isn&apos;t.</h2>
              <p className="text-stone-500 text-sm leading-relaxed mb-4">
                Every commit, email, message, and session produces signal. But it lives in silos — GitHub here,
                Slack there, a Claude Code tab somewhere else. When a project stalls, the culprit is rarely
                missing effort. It&apos;s missing visibility into what effort is producing.
              </p>
              <p className="text-stone-500 text-sm leading-relaxed">
                work-state closes that gap by treating your work surfaces as data sources and building an
                intelligence layer on top — one that quickly adapts to work that&apos;s already in progress,
                rather than demanding a workflow change before delivering value.
              </p>
            </div>
            <div className="space-y-3">
              {[
                { problem: 'Which project got the most Claude time this week?', solved: true },
                { problem: 'Did I actually publish anything last month?', solved: true },
                { problem: 'What\'s the velocity trend across my top three projects?', solved: true },
                { problem: 'Are my Claude sessions getting more agentic over time?', solved: true },
                { problem: 'What did I communicate to whom about Project X?', solved: true },
                { problem: 'Which branches have I been working on most?', solved: true },
              ].map(({ problem, solved }) => (
                <div key={problem} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 shrink-0 text-sm ${solved ? 'text-emerald-500' : 'text-stone-300'}`}>
                    {solved ? '✓' : '×'}
                  </span>
                  <span className="text-sm text-stone-600">{problem}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Architecture ──────────────────────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Architecture</div>
          <h2 className="text-xl font-bold text-stone-800 mb-6">Four layers. Each reads only from the layer below.</h2>
          <div className="space-y-2">
            {LAYERS.map((layer, i) => (
              <div key={layer.label} className={`border ${layer.border} ${layer.bg} p-4 flex items-center gap-4`}>
                <div className="w-8 shrink-0 text-center text-lg" style={{ color: layer.color }}>{layer.icon}</div>
                <div className="flex-1">
                  <div className="font-bold text-stone-700">{layer.label}</div>
                  <div className="text-xs text-stone-400 font-mono mt-0.5">{layer.sub}</div>
                </div>
                {i < LAYERS.length - 1 && (
                  <div className="text-xs text-stone-300 shrink-0">reads from ↓</div>
                )}
                {i === LAYERS.length - 1 && (
                  <div className="text-xs font-semibold shrink-0" style={{ color: layer.color }}>source of truth</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-stone-400">
            <div className="bg-white border border-stone-200 p-3">
              <div className="font-semibold text-stone-600 mb-1">Immutable events</div>
              Events are write-once JSON files with deterministic IDs. Re-harvesting is always safe — duplicates are detected and skipped.
            </div>
            <div className="bg-white border border-stone-200 p-3">
              <div className="font-semibold text-stone-600 mb-1">Schema-governed</div>
              Every event follows a canonical envelope: surface, type, timestamp, actor, project, evidence, metrics, raw.
            </div>
            <div className="bg-white border border-stone-200 p-3">
              <div className="font-semibold text-stone-600 mb-1">Local-first</div>
              Email bodies, Slack DMs, and session transcripts stay on your machine. Nothing leaves unless you build an explicit export.
            </div>
          </div>
        </div>

        {/* ── Surfaces ──────────────────────────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Six surfaces · six harvesters</div>
          <h2 className="text-xl font-bold text-stone-800 mb-6">Wherever you work, evidence is captured.</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(SURFACE_PILLS).map(([key, s]) => (
              <div key={key} className="bg-white border border-stone-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                  <span className="text-sm font-bold text-stone-700">{s.label}</span>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">{s.what}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Skills ────────────────────────────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Skills · slash commands</div>
          <h2 className="text-xl font-bold text-stone-800 mb-6">Nine skills. Each does one thing precisely.</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {SKILLS.map(skill => (
              <div key={skill.cmd} className={`border ${skill.border} ${skill.bg} p-4`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <code className="text-xs font-mono font-bold" style={{ color: skill.color }}>{skill.cmd}</code>
                  <span className="text-xs text-stone-400 shrink-0">{skill.role}</span>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">{skill.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── What you get ──────────────────────────────────────────────────── */}
        <div className="bg-white border border-stone-200 shadow-sm p-8">
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">What you get</div>
          <h2 className="text-xl font-bold text-stone-800 mb-6">Intelligence, not just data.</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {[
                { icon: '⬡', label: 'Kanban board', desc: 'Projects as columns, draggable. Surface badges show where activity is coming from. Sparklines show recent velocity.' },
                { icon: '⬡', label: 'Activity dashboard', desc: 'Day-by-day volume across all surfaces. Work pattern chart — Code / Create / Share / Communicate modes. DOW fingerprint.' },
                { icon: '⬡', label: 'Inventory', desc: 'Flat list of all projects with surface breakdown bars, status, and last activity. Full-text filter.' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex gap-3">
                  <span className="text-amber-600 text-lg shrink-0 mt-0.5">{icon}</span>
                  <div>
                    <div className="text-sm font-bold text-stone-700 mb-1">{label}</div>
                    <p className="text-xs text-stone-500 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {[
                { icon: '⬡', label: 'Claudash', desc: 'Dedicated Claude Code intelligence — session character scatter, agentic trajectory trend, tool mix over time, hour×DOW timing matrix, burst analysis.' },
                { icon: '⬡', label: 'Daily digests', desc: 'Narrative digest of the day\'s events, derived from evidence, not hand-written. Generated via /work-orchestrator.' },
                { icon: '⬡', label: 'Weekly and longitudinal reports', desc: 'Velocity trends, theme emergence, project momentum — rolling summaries that compound over time.' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex gap-3">
                  <span className="text-amber-600 text-lg shrink-0 mt-0.5">{icon}</span>
                  <div>
                    <div className="text-sm font-bold text-stone-700 mb-1">{label}</div>
                    <p className="text-xs text-stone-500 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Ecosystem ─────────────────────────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Intelligence facility suite</div>
          <h2 className="text-xl font-bold text-stone-800 mb-2">Part of something larger.</h2>
          <p className="text-sm text-stone-500 mb-6 max-w-2xl leading-relaxed">
            work-state is a companion to <strong className="text-stone-700">project-state</strong> and sits alongside a growing suite of intelligence facilities — each designed to quickly adapt to work already in progress and build an intelligence layer where gaps previously derailed projects.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ECOSYSTEM.map(ec => (
              <div key={ec.name} className={`bg-white border-l-4 border border-stone-200 p-5 shadow-sm relative ${ec.current ? 'border-l-amber-400' : 'border-l-stone-200'}`}
                style={{ borderLeftColor: ec.accent }}>
                {ec.current && (
                  <span className="absolute top-3 right-3 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5">you are here</span>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ec.accent }} />
                  <span className="font-bold text-stone-700 font-mono text-sm">{ec.name}</span>
                </div>
                <div className="text-xs font-semibold mb-2" style={{ color: ec.accent }}>{ec.tagline}</div>
                <p className="text-xs text-stone-500 leading-relaxed">{ec.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-stone-50 border border-stone-200 p-4 text-xs text-stone-500 leading-relaxed">
            <strong className="text-stone-700">Common design principles across all facilities:</strong> local-first data storage · immutable event sourcing · Claude Code skill invocation via slash commands · schema-governed state · idempotent harvesting · no mandatory workflow change — adapt to work that already exists.
          </div>
        </div>

        {/* ── Quick start ───────────────────────────────────────────────────── */}
        <div className="bg-stone-900 text-stone-300 p-8">
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-4">Quick start</div>
          <h2 className="text-xl font-bold text-stone-100 mb-6">Up in three commands.</h2>
          <div className="space-y-4 font-mono text-sm">
            {[
              { cmd: '/work-state init', comment: '# one-time setup · creates manifest.yaml, state.json, directories' },
              { cmd: '/work-harvester-github --since 30d', comment: '# harvest the last 30 days of GitHub activity' },
              { cmd: '/work-kanban', comment: '# auto-installs the UI, opens http://localhost:3333' },
            ].map(({ cmd, comment }, i) => (
              <div key={cmd} className="flex items-start gap-4">
                <span className="text-stone-600 shrink-0 mt-0.5">{i + 1}.</span>
                <div>
                  <div className="text-amber-400">{cmd}</div>
                  <div className="text-stone-600 text-xs mt-0.5">{comment}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-5 border-t border-stone-800 text-xs text-stone-500">
            Prerequisites: <code className="text-stone-400">gh</code> CLI authenticated · Gmail / Slack / Google Drive / scsiwyg MCPs configured in Claude Code · Node.js + npm for the kanban UI
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="text-xs text-stone-400 text-center pb-4">
          work-state v1.1.0 · MIT · <span className="font-mono">~/work-state/</span> · built by Atomic 47 Labs
        </div>

      </main>
    </div>
  )
}
