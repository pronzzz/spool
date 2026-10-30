import type { Engine, JobItem, JobSummary, Snapshot, Source } from './types'

// A made-up playlist so visitors can see Spool work without installing it.
const TITLES = [
  ['Rain on a tin roof', 412],
  ['Night train out of Kraków', 1260],
  ['Harbour at 5am', 538],
  ['Kettle, radio, kitchen window', 301],
  ['Thunder over the allotments', 724],
  ['Market hall, Saturday', 966],
  ['Wind through a pine forest', 1802],
  ['Last bus, upper deck', 455],
  ['Library reading room', 1499],
  ['Snowfall, no traffic', 860],
  ['Ferry engine room', 640],
  ['Cicadas after dusk', 1205],
  ['Laundrette spin cycle', 377],
  ['Bell tower, quarter past', 92],
  ['Low tide, shingle beach', 1030],
  ['Old typewriter, one page', 245],
] as const

export const DEMO_SOURCE: Source = {
  kind: 'playlist',
  id: 'demo',
  url: 'https://www.youtube.com/playlist?list=SPOOL_DEMO',
  title: 'Field recordings, vol. 1',
  channel: 'Spool demo',
  items: TITLES.map(([title, duration], i) => ({
    id: `demo${String(i).padStart(7, '0')}`,
    index: i + 1,
    title,
    channel: 'Spool demo',
    duration,
    unavailable: i === 13,
  })),
}

// Item 6 fails once (shows the retry flow); item 3 is "already in the folder".
const FAILS_ONCE = 5
const ALREADY_SAVED = 2

export function demoEngine(): Engine {
  const jobs = new Map<string, { job: JobSummary; items: JobItem[]; listeners: Set<(s: Snapshot, full: boolean) => void>; failed: Set<string> }>()

  function summarize(job: JobSummary, items: JobItem[]) {
    const counts = { queued: 0, active: 0, done: 0, skipped: 0, failed: 0, cancelled: 0 }
    let speed = 0
    for (const it of items) {
      if (it.state === 'downloading' || it.state === 'converting') {
        counts.active++
        speed += it.speed ?? 0
      } else counts[it.state]++
    }
    job.counts = counts
    job.speed = speed
    if (job.state === 'running' && counts.queued + counts.active === 0) {
      job.state = 'done'
      job.finishedAt = Date.now()
    }
  }

  function tick(id: string) {
    const entry = jobs.get(id)
    if (!entry || entry.job.state !== 'running') return
    const { items, failed } = entry
    let active = items.filter((it) => it.state === 'downloading' || it.state === 'converting').length
    for (const it of items) {
      if (active >= 3) break
      if (it.state === 'queued') {
        it.state = 'downloading'
        active++
      }
    }
    for (const it of items) {
      if (it.state === 'downloading') {
        if (it.index - 1 === ALREADY_SAVED) {
          Object.assign(it, { state: 'skipped', progress: 100, speed: null, eta: null })
          continue
        }
        it.progress = Math.min(100, it.progress + 3 + Math.random() * 9)
        it.speed = 2_400_000 + Math.random() * 3_000_000
        it.eta = Math.round((100 - it.progress) / 6)
        if (it.index - 1 === FAILS_ONCE && it.progress > 40 && !failed.has(it.id)) {
          failed.add(it.id)
          Object.assign(it, { state: 'failed', progress: 0, speed: null, eta: null, error: 'Video unavailable in your country' })
        } else if (it.progress >= 100) {
          Object.assign(it, { state: 'converting', progress: 99, speed: null, eta: null })
        }
      } else if (it.state === 'converting' && Math.random() < 0.35) {
        const ext = entry.job.format
        Object.assign(it, { state: 'done', progress: 100, file: `${String(it.index).padStart(3, '0')} ${it.title}.${ext}` })
      }
    }
    summarize(entry.job, items)
    const snap = { job: { ...entry.job }, items: items.map((i) => ({ ...i })) }
    entry.listeners.forEach((fn) => fn(snap, true))
    if (entry.job.state === 'running') setTimeout(() => tick(id), 180)
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const snapshot = (id: string): Snapshot => {
    const e = jobs.get(id)!
    return { job: { ...e.job }, items: e.items.map((i) => ({ ...i })) }
  }

  return {
    demo: true,
    async health() {
      return {
        app: 'spool',
        version: __VERSION__,
        dir: '~/Downloads/Spool',
        concurrency: 3,
        tools: { ytdlp: { ok: true, version: 'demo' }, ffmpeg: { ok: true, version: 'demo' } },
      }
    },
    async inspect() {
      await wait(700)
      return DEMO_SOURCE
    },
    async jobs() {
      return [...jobs.values()].map((e) => e.job)
    },
    async start(req) {
      const id = `demo-${Date.now()}`
      const job: JobSummary = {
        id,
        title: req.title,
        kind: req.kind,
        format: req.format,
        quality: req.quality,
        dir: `~/Downloads/Spool/${req.title}`,
        state: 'running',
        total: req.items.length,
        counts: { queued: req.items.length, active: 0, done: 0, skipped: 0, failed: 0, cancelled: 0 },
        speed: 0,
        createdAt: Date.now(),
        finishedAt: null,
      }
      const items: JobItem[] = req.items.map((it) => ({
        ...it,
        state: 'queued',
        progress: 0,
        speed: null,
        eta: null,
        file: null,
        error: null,
      }))
      jobs.set(id, { job, items, listeners: new Set(), failed: new Set() })
      setTimeout(() => tick(id), 300)
      return snapshot(id)
    },
    async snapshot(id) {
      return snapshot(id)
    },
    subscribe(id, on) {
      const e = jobs.get(id)
      if (!e) return () => {}
      e.listeners.add(on)
      on(snapshot(id), true)
      return () => e.listeners.delete(on)
    },
    async cancel(id) {
      const e = jobs.get(id)
      if (!e) return
      for (const it of e.items) {
        if (it.state !== 'done' && it.state !== 'skipped' && it.state !== 'failed') {
          Object.assign(it, { state: 'cancelled', speed: null, eta: null })
        }
      }
      e.job.state = 'cancelled'
      e.job.finishedAt = Date.now()
      summarize(e.job, e.items)
      e.listeners.forEach((fn) => fn(snapshot(id), true))
    },
    async retry(id) {
      const e = jobs.get(id)
      if (!e) return
      for (const it of e.items) {
        if (it.state === 'failed' || it.state === 'cancelled') Object.assign(it, { state: 'queued', progress: 0, error: null })
      }
      e.job.state = 'running'
      e.job.finishedAt = null
      setTimeout(() => tick(id), 200)
    },
    async reveal() {},
  }
}
