import { memo, type CSSProperties } from 'react'
import { duration, hue, speed, thumb } from '../lib/format'
import type { JobItem, SourceItem } from '../lib/types'

interface Props {
  item: SourceItem
  run?: JobItem
  checked: boolean
  selectable: boolean
  demo: boolean
  onToggle: (id: string, shift: boolean) => void
}

const STATE_TEXT: Record<JobItem['state'], string> = {
  queued: 'Waiting',
  downloading: '',
  converting: 'Converting',
  done: 'Saved',
  skipped: 'Already saved',
  failed: 'Failed',
  cancelled: 'Stopped',
}

function ItemRow({ item, run, checked, selectable, demo, onToggle }: Props) {
  const state = run?.state
  const live = state === 'downloading' || state === 'converting'
  const status = state === 'downloading' ? `${Math.round(run!.progress)}%${run?.speed ? ` · ${speed(run.speed)}` : ''}` : state ? STATE_TEXT[state] : duration(item.duration)

  return (
    <li
      className={`row${state ? ` is-${state}` : ''}${!checked && selectable ? ' is-off' : ''}${item.unavailable ? ' is-unavailable' : ''}`}
      onClick={selectable ? (e) => onToggle(item.id, e.shiftKey) : undefined}
      // Shift-click is for range selection, not text selection.
      onMouseDown={selectable ? (e) => e.shiftKey && e.preventDefault() : undefined}
    >
      <span className="row-lead">
        {selectable ? (
          <input
            type="checkbox"
            className="check"
            checked={checked}
            aria-label={`Include ${item.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(item.id, e.shiftKey)
            }}
            onChange={() => {}}
          />
        ) : (
          <StateGlyph state={state} />
        )}
      </span>
      <span className="row-index mono">{String(item.index).padStart(3, '0')}</span>
      <span className="row-thumb" aria-hidden="true">
        {demo ? (
          <span className="row-thumb-demo" style={{ '--h': hue(item.id) } as CSSProperties} />
        ) : (
          <img src={thumb(item.id)} alt="" loading="lazy" decoding="async" width="64" height="36" />
        )}
      </span>
      <span className="row-main">
        <span className="row-title">{item.title}</span>
        {run?.error ? (
          <span className="row-error">{run.error}</span>
        ) : run?.file ? (
          <span className="row-meta mono">{run.file}</span>
        ) : item.unavailable ? (
          <span className="row-meta">Private or deleted</span>
        ) : null}
      </span>
      <span className={`row-status${live ? ' mono' : ''}`}>{status}</span>
      {live && <span className="row-bar" style={{ transform: `scaleX(${(run!.progress / 100).toFixed(3)})` }} />}
    </li>
  )
}

function StateGlyph({ state }: { state?: JobItem['state'] }) {
  if (state === 'downloading' || state === 'converting') return <span className="glyph glyph-live" aria-label="Working" />
  if (state === 'done') {
    return (
      <svg className="glyph glyph-done" viewBox="0 0 16 16" aria-label="Saved">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'skipped') return <span className="glyph glyph-text" aria-label="Already saved">=</span>
  if (state === 'failed') return <span className="glyph glyph-text glyph-failed" aria-label="Failed">!</span>
  return <span className="glyph glyph-wait" aria-label="Waiting" />
}

export default memo(ItemRow)
