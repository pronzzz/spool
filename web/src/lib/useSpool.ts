import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { demoEngine } from './demo'
import { EngineError, realEngine, servedByEngine } from './engine'
import { QUALITIES } from './format'
import type { Engine, Format, Health, JobItem, JobSummary, Snapshot, Source } from './types'

export type Status = 'idle' | 'checking' | 'online' | 'offline'

const SEEN_KEY = 'spool.engine-seen'
const FORMAT_KEY = 'spool.format'

function store<T>(key: string, value?: T): T | null {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null')
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage can be blocked; nothing depends on it */
  }
  return null
}

function sourceFromSnapshot(s: Snapshot): Source {
  return {
    kind: s.job.kind,
    id: s.job.id,
    url: '',
    title: s.job.title,
    channel: null,
    items: s.items.map((it) => ({ id: it.id, index: it.index, title: it.title, channel: null, duration: null, unavailable: false })),
  }
}

export function useSpool() {
  const [engine, setEngine] = useState<Engine>(() => realEngine())
  const [status, setStatus] = useState<Status>('idle')
  const [health, setHealth] = useState<Health | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const saved = store<{ format: Format; quality: string }>(FORMAT_KEY)
  const [format, setFormatState] = useState<Format>(saved?.format ?? 'mp3')
  const [quality, setQuality] = useState<string>(saved?.quality ?? '320')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsEngine, setNeedsEngine] = useState(false)
  const [job, setJob] = useState<JobSummary | null>(null)
  const [items, setItems] = useState<Record<string, JobItem>>({})
  const pendingUrl = useRef<string | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  const follow = useCallback((eng: Engine, id: string) => {
    unsubscribe.current?.()
    unsubscribe.current = eng.subscribe(id, (snap, full) => {
      setJob(snap.job)
      setItems((prev) => {
        const next = full ? {} : { ...prev }
        for (const it of snap.items) next[it.id] = it
        return next
      })
    })
  }, [])

  useEffect(() => () => unsubscribe.current?.(), [])

  const inspectWith = useCallback(async (eng: Engine, url: string) => {
    setBusy(true)
    setError(null)
    try {
      const src = await eng.inspect(url)
      unsubscribe.current?.()
      setJob(null)
      setItems({})
      setSource(src)
      setSelected(new Set(src.items.filter((i) => !i.unavailable).map((i) => i.id)))
    } catch (err) {
      if (err instanceof EngineError && err.offline) {
        setStatus('offline')
        setNeedsEngine(true)
        pendingUrl.current = url
      } else setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const connect = useCallback(async (): Promise<Engine | null> => {
    const eng = realEngine()
    setStatus('checking')
    try {
      const h = await eng.health()
      if (h.app !== 'spool') throw new Error('not spool')
      setEngine(eng)
      setHealth(h)
      setStatus('online')
      setNeedsEngine(false)
      store(SEEN_KEY, true)
      if (!h.tools.ffmpeg.ok) {
        setFormatState((f) => (f === 'mp3' ? 'm4a' : f))
        setQuality((q) => (format === 'mp3' ? 'best' : q))
      }
      // Pick up a job that was running before the page reloaded.
      const running = (await eng.jobs()).find((j) => j.state === 'running')
      if (running) {
        const snap = await eng.snapshot(running.id)
        setSource(sourceFromSnapshot(snap))
        setSelected(new Set(snap.items.map((i) => i.id)))
        follow(eng, running.id)
      } else if (pendingUrl.current) {
        const url = pendingUrl.current
        pendingUrl.current = null
        void inspectWith(eng, url)
      }
      return eng
    } catch {
      setStatus('offline')
      return null
    }
  }, [follow, inspectWith, format])

  // Check right away when the engine served this page or answered before.
  // Otherwise wait for the visitor: probing localhost can trigger a browser
  // permission prompt.
  useEffect(() => {
    if (servedByEngine || store<boolean>(SEEN_KEY)) void connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inspect = useCallback(
    async (url: string) => {
      if (engine.demo) return inspectWith(engine, url)
      if (status !== 'online') {
        pendingUrl.current = url
        const eng = await connect()
        if (!eng) {
          setNeedsEngine(true)
          return
        }
        pendingUrl.current = null
        return inspectWith(eng, url)
      }
      return inspectWith(engine, url)
    },
    [engine, status, connect, inspectWith],
  )

  const startDemo = useCallback(async () => {
    const eng = demoEngine()
    unsubscribe.current?.()
    setEngine(eng)
    setHealth(await eng.health())
    setStatus('online')
    setNeedsEngine(false)
    pendingUrl.current = null
    if (format === 'mp3' && !QUALITIES.mp3.some((q) => q.value === quality)) setQuality('320')
    await inspectWith(eng, 'demo')
  }, [inspectWith, format, quality])

  const leaveDemo = useCallback(() => {
    unsubscribe.current?.()
    setEngine(realEngine())
    setStatus('idle')
    setHealth(null)
    setSource(null)
    setJob(null)
    setItems({})
  }, [])

  const setFormat = useCallback((f: Format, q?: string) => {
    const nextQ = q ?? QUALITIES[f][0].value
    setFormatState(f)
    setQuality(nextQ)
    store(FORMAT_KEY, { format: f, quality: nextQ })
  }, [])

  const pickQuality = useCallback(
    (q: string) => {
      setQuality(q)
      store(FORMAT_KEY, { format, quality: q })
    },
    [format],
  )

  const start = useCallback(async () => {
    if (!source || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const snap = await engine.start({
        title: source.title,
        kind: source.kind,
        sourceUrl: source.url,
        format,
        quality,
        items: source.items.filter((i) => selected.has(i.id)).map(({ id, index, title }) => ({ id, index, title })),
      })
      setJob(snap.job)
      setItems(Object.fromEntries(snap.items.map((i) => [i.id, i])))
      follow(engine, snap.job.id)
    } catch (err) {
      setError((err as Error).message)
      if (err instanceof EngineError && err.offline) setStatus('offline')
    } finally {
      setBusy(false)
    }
  }, [engine, source, selected, format, quality, follow])

  const act = useCallback(
    async (fn: (id: string) => Promise<void>) => {
      if (!job) return
      try {
        await fn(job.id)
        if (engine.demo) follow(engine, job.id)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [job, engine, follow],
  )

  const clear = useCallback(() => {
    unsubscribe.current?.()
    unsubscribe.current = null
    setSource(null)
    setJob(null)
    setItems({})
    setError(null)
  }, [])

  const progress = useMemo(() => {
    if (!job) return { finished: 0, total: source ? selected.size : 0, share: 0 }
    const c = job.counts
    const partial = Object.values(items).reduce(
      (sum, it) => sum + (it.state === 'downloading' || it.state === 'converting' ? it.progress / 100 : 0),
      0,
    )
    const finished = c.done + c.skipped + c.failed
    return { finished: c.done + c.skipped, total: job.total, share: job.total ? (finished + partial) / job.total : 0 }
  }, [job, items, source, selected])

  useEffect(() => {
    document.title = job?.state === 'running' ? `(${progress.finished}/${progress.total}) Spool` : 'Spool — wind YouTube playlists onto your disk'
  }, [job?.state, progress.finished, progress.total])

  return {
    engine,
    status,
    health,
    source,
    selected,
    setSelected,
    format,
    quality,
    setFormat,
    pickQuality,
    busy,
    error,
    needsEngine,
    job,
    items,
    progress,
    connect,
    inspect,
    start,
    startDemo,
    leaveDemo,
    clear,
    cancel: () => act(engine.cancel),
    retry: () => act(engine.retry),
    reveal: () => act(engine.reveal),
  }
}

export type Spool = ReturnType<typeof useSpool>
