import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { FORMAT_NOTES, longDuration, QUALITIES, speed } from '../lib/format'
import { RUN, TOOLS, detectOS } from '../lib/install'
import type { Spool } from '../lib/useSpool'
import type { Format } from '../lib/types'
import { CopyCommand, useMagnet } from './bits'
import ItemRow from './ItemRow'

export default function Console({ spool }: { spool: Spool }) {
  const { source, job, error, busy, needsEngine } = spool
  return (
    <section className="console" id="app" aria-label="Spool">
      <StatusBar spool={spool} />
      <UrlForm spool={spool} />
      {error && !busy && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      {needsEngine && !source && <EngineHelp spool={spool} />}
      {source && <SourcePanel key={source.id + (job?.id ?? '')} spool={spool} />}
    </section>
  )
}

function StatusBar({ spool }: { spool: Spool }) {
  const { status, health, engine } = spool
  if (engine.demo) {
    return (
      <div className="status">
        <span className="status-dot is-demo" />
        <span>Demo — nothing is downloaded</span>
        <button type="button" className="link" onClick={spool.leaveDemo}>
          Leave demo
        </button>
      </div>
    )
  }
  if (status === 'online' && health) {
    const yt = health.tools.ytdlp
    return (
      <div className="status">
        <span className="status-dot is-on" />
        <span>
          Engine {health.version} <span className="faint">·</span> yt-dlp {yt.version ?? 'missing'}
          {!health.tools.ffmpeg.ok && <span className="warn"> · no ffmpeg</span>}
        </span>
        {yt.stale && <span className="warn">yt-dlp is old — update it if downloads fail</span>}
      </div>
    )
  }
  return (
    <div className="status">
      <span className={`status-dot${status === 'checking' ? ' is-checking' : ''}`} />
      <span>{status === 'checking' ? 'Looking for the engine…' : 'Engine not connected'}</span>
      {status !== 'checking' && (
        <button type="button" className="link" onClick={() => void spool.connect()}>
          {status === 'offline' ? 'Check again' : 'Connect'}
        </button>
      )}
    </div>
  )
}

function UrlForm({ spool }: { spool: Spool }) {
  const [url, setUrl] = useState('')
  const [shake, setShake] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const running = spool.job?.state === 'running'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (spool.error) setShake((n) => n + 1)
  }, [spool.error])

  const submit = (value: string, e?: FormEvent) => {
    e?.preventDefault()
    const v = value.trim()
    if (!v) {
      input.current?.focus()
      setShake((n) => n + 1)
      return
    }
    void spool.inspect(v)
  }

  return (
    <form className="url" onSubmit={(e) => submit(url, e)}>
      <label className="sr-only" htmlFor="url">
        YouTube link
      </label>
      <div key={shake} className={`url-field${shake ? ' shake' : ''}`}>
        <input
          ref={input}
          id="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellcheck={false}
          placeholder={spool.engine.demo ? 'Any link works in the demo' : 'Paste a YouTube playlist or video link'}
          value={url}
          disabled={running}
          onInput={(e) => setUrl(e.currentTarget.value)}
          onPaste={(e) => {
            // Pasting a link is intent enough; skip the click.
            const pasted = (e.clipboardData?.getData('text') ?? '').trim()
            if (/^https?:\/\//.test(pasted)) {
              e.preventDefault()
              setUrl(pasted)
              submit(pasted)
            }
          }}
        />
        <kbd className="url-kbd" aria-hidden="true">
          /
        </kbd>
        <button type="submit" className="btn btn-quiet" disabled={spool.busy || running}>
          {spool.busy && !spool.source ? <span className="spinner" aria-label="Reading" /> : 'Read link'}
        </button>
      </div>
      {!spool.source && !spool.engine.demo && (
        <p className="url-hint">
          Paste and it starts reading. No engine yet?{' '}
          <button type="button" className="link" onClick={() => void spool.startDemo()}>
            Try the demo
          </button>
        </p>
      )}
    </form>
  )
}

function EngineHelp({ spool }: { spool: Spool }) {
  const os = detectOS()
  return (
    <div className="help">
      <p className="help-title">Start Spool’s engine on this computer</p>
      <p className="help-body">
        Downloads run on your machine, not a server. Run this in a terminal, then come back — or use the window it opens.
      </p>
      <CopyCommand command={RUN} />
      <p className="help-body faint">
        Needs Node 20+, yt-dlp and ffmpeg. On {TOOLS[os].label}: <code>{TOOLS[os].command}</code>
      </p>
      <div className="help-actions">
        <button type="button" className="btn" onClick={() => void spool.connect()} disabled={spool.status === 'checking'}>
          {spool.status === 'checking' ? 'Checking…' : 'I’ve started it'}
        </button>
        <button type="button" className="link" onClick={() => void spool.startDemo()}>
          Try the demo instead
        </button>
      </div>
      <p className="help-body faint small">
        Safari blocks pages from talking to localhost. Use the window the engine opens, or Chrome, Edge, Arc or Firefox.
      </p>
    </div>
  )
}

function SourcePanel({ spool }: { spool: Spool }) {
  const { source, selected, setSelected, job, items, engine, health } = spool
  const [filter, setFilter] = useState('')
  const lastIndex = useRef<number | null>(null)
  const locked = Boolean(job)
  const all = source!.items

  const visible = useMemo(() => {
    const list = job ? all.filter((i) => items[i.id]) : all
    const q = filter.trim().toLowerCase()
    return q ? list.filter((i) => i.title.toLowerCase().includes(q)) : list
  }, [all, job, items, filter])

  const toggle = useCallback(
    (id: string, shift: boolean) => {
      const idx = visible.findIndex((i) => i.id === id)
      setSelected((prev) => {
        const next = new Set(prev)
        const on = !prev.has(id)
        // Shift-click selects or clears the whole run since the last click.
        if (shift && lastIndex.current !== null) {
          const [a, b] = [lastIndex.current, idx].sort((x, y) => x - y)
          for (const it of visible.slice(a, b + 1)) on ? next.add(it.id) : next.delete(it.id)
        } else on ? next.add(id) : next.delete(id)
        return next
      })
      lastIndex.current = idx
    },
    [visible, setSelected],
  )

  const total = all.filter((i) => selected.has(i.id)).reduce((s, i) => s + (i.duration ?? 0), 0)
  const allOn = visible.length > 0 && visible.every((i) => selected.has(i.id))

  return (
    <div className="source">
      <header className="source-head">
        <div>
          <p className="eyebrow">{source!.kind === 'playlist' ? 'Playlist' : 'Video'}</p>
          <h2 className="source-title">{source!.title}</h2>
          <p className="source-meta">
            {[source!.channel, `${all.length} ${all.length === 1 ? 'video' : 'videos'}`, total ? longDuration(total) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {!(job?.state === 'running') && (
          <button type="button" className="icon-btn" aria-label="Clear" onClick={spool.clear}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </header>

      {!locked && <Options spool={spool} />}

      {all.length > 1 && (
        <div className="tools">
          {!locked ? (
            <label className="tools-all">
              <input
                type="checkbox"
                className="check"
                checked={allOn}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    for (const i of visible) allOn ? next.delete(i.id) : next.add(i.id)
                    return next
                  })
                }
              />
              <span>
                {selected.size} of {all.length}
              </span>
            </label>
          ) : (
            <span className="tools-all">
              <span>{job!.total} in this run</span>
            </span>
          )}
          <input className="tools-filter" type="search" placeholder="Filter" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} aria-label="Filter videos" />
          {!locked && <span className="tools-tip">Shift-click to select a range</span>}
        </div>
      )}

      <ol className="rows">
        {visible.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            run={items[item.id]}
            checked={selected.has(item.id)}
            selectable={!locked && all.length > 1}
            demo={engine.demo}
            onToggle={toggle}
          />
        ))}
      </ol>

      <ActionBar spool={spool} total={total} dir={health?.dir} />
    </div>
  )
}

function Options({ spool }: { spool: Spool }) {
  const { format, quality, setFormat, pickQuality, health } = spool
  const noFfmpeg = health ? !health.tools.ffmpeg.ok : false
  const formats: { id: Format; label: string }[] = [
    { id: 'mp3', label: 'MP3' },
    { id: 'm4a', label: 'M4A' },
    { id: 'mp4', label: 'MP4' },
  ]
  return (
    <div className="options">
      <div className="seg" role="radiogroup" aria-label="Format">
        {formats.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={format === f.id}
            className={`seg-btn${format === f.id ? ' is-on' : ''}`}
            disabled={f.id === 'mp3' && noFfmpeg}
            title={f.id === 'mp3' && noFfmpeg ? 'MP3 needs ffmpeg' : undefined}
            onClick={() => setFormat(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {QUALITIES[format].length > 1 && (
        <div className="chips" role="radiogroup" aria-label="Quality">
          {QUALITIES[format].map((q) => (
            <button
              key={q.value}
              type="button"
              role="radio"
              aria-checked={quality === q.value}
              className={`chip${quality === q.value ? ' is-on' : ''}`}
              onClick={() => pickQuality(q.value)}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
      <p className="options-note">
        {FORMAT_NOTES[format]}
        {format === 'mp4' && noFfmpeg && ' Without ffmpeg, video is limited to 360p.'}
      </p>
    </div>
  )
}

function ActionBar({ spool, total, dir }: { spool: Spool; total: number; dir?: string }) {
  const { job, selected, source, busy, engine } = spool
  const magnet = useMagnet<HTMLButtonElement>()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !job) void spool.start()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [job, spool])

  if (!job) {
    const where = source!.kind === 'playlist' ? `${dir ?? '~/Downloads/Spool'}/${source!.title}` : dir ?? '~/Downloads/Spool'
    return (
      <div className="bar">
        <p className="bar-info">
          <span className="mono">{selected.size}</span> {selected.size === 1 ? 'video' : 'videos'}
          {total ? ` · ${longDuration(total)}` : ''}
          <span className="bar-path" title={where}>
            → {where.replace(/^\/Users\/[^/]+/, '~')}
          </span>
        </p>
        <button ref={magnet} type="button" className="btn btn-primary" disabled={selected.size === 0 || busy} onClick={() => void spool.start()}>
          {busy ? <span className="spinner" /> : <>Spool {selected.size || ''}</>}
          <span className="btn-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>
    )
  }

  const c = job.counts
  const running = job.state === 'running'
  return (
    <div className={`bar${running ? ' is-running' : ' is-done'}`}>
      <p className="bar-info">
        {running ? (
          <>
            <span className="mono">{c.done + c.skipped}</span> saved
            {c.active ? <> · <span className="mono">{c.active}</span> working</> : null}
            {c.failed ? <span className="warn"> · {c.failed} failed</span> : null}
            {job.speed ? <span className="mono faint"> · {speed(job.speed)}</span> : null}
          </>
        ) : job.state === 'cancelled' ? (
          <>Stopped. {c.done + c.skipped} saved.</>
        ) : (
          <>
            Done. <span className="mono">{c.done}</span> saved
            {c.skipped ? <>, {c.skipped} already there</> : null}
            {c.failed ? <span className="warn">, {c.failed} failed</span> : null}.
          </>
        )}
      </p>
      <div className="bar-actions">
        {running ? (
          <button type="button" className="btn btn-quiet" onClick={() => void spool.cancel()}>
            Stop
          </button>
        ) : (
          <>
            {c.failed + c.cancelled > 0 && (
              <button type="button" className="btn btn-quiet" onClick={() => void spool.retry()}>
                Retry {c.failed + c.cancelled}
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={spool.clear}>
              New link
            </button>
            {!engine.demo && (
              <button type="button" className="btn btn-primary" onClick={() => void spool.reveal()}>
                Open folder
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
