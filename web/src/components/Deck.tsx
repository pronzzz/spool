import { useEffect, useRef } from 'react'
import { pad3 } from '../lib/format'

interface Props {
  /** 0..1 share of the job that has finished. */
  progress: number
  active: boolean
  done: number
  total: number
  label: string
}

const L = { x: 128, y: 118 }
const R = { x: 312, y: 118 }
const HUB = 20
const MAX = 66
const POST_L = { x: 66, y: 212 }
const POST_R = { x: 374, y: 212 }

/** Tape pack radius for a share of tape: area grows linearly, radius doesn't. */
const packRadius = (share: number) => Math.sqrt(HUB * HUB + (MAX * MAX - HUB * HUB) * Math.max(0, Math.min(1, share)))

/** Tangent point from an outside point to a circle, on the requested side. */
function tangent(c: { x: number; y: number }, r: number, p: { x: number; y: number }, side: 1 | -1) {
  const dx = p.x - c.x
  const dy = p.y - c.y
  const d = Math.hypot(dx, dy)
  const base = Math.atan2(dy, dx)
  const a = Math.acos(Math.min(1, r / d))
  const t = base + side * a
  return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }
}

export default function Deck({ progress, active, done, total, label }: Props) {
  const packL = useRef<SVGCircleElement>(null)
  const packR = useRef<SVGCircleElement>(null)
  const hubL = useRef<SVGGElement>(null)
  const hubR = useRef<SVGGElement>(null)
  const tape = useRef<SVGPathElement>(null)
  const target = useRef({ progress, active })
  target.current = { progress, active }

  useEffect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let shown = target.current.progress
    let angleL = 0
    let angleR = 0
    let speed = 0
    let last = performance.now()
    let frame = 0

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = target.current
      shown += (t.progress - shown) * Math.min(1, dt * 3)
      const rl = packRadius(1 - shown)
      const rr = packRadius(shown)
      // Tape moves at a steady speed, so the smaller pack turns faster.
      const want = still ? 0 : t.active ? 70 : 7
      speed += (want - speed) * Math.min(1, dt * 2)
      angleL += ((speed / rl) * dt * 180) / Math.PI
      angleR += ((speed / rr) * dt * 180) / Math.PI

      packL.current?.setAttribute('r', rl.toFixed(2))
      packR.current?.setAttribute('r', rr.toFixed(2))
      hubL.current?.setAttribute('transform', `rotate(${angleL % 360} ${L.x} ${L.y})`)
      hubR.current?.setAttribute('transform', `rotate(${angleR % 360} ${R.x} ${R.y})`)
      const a = tangent(L, rl, POST_L, 1)
      const b = tangent(R, rr, POST_R, -1)
      tape.current?.setAttribute(
        'd',
        `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${POST_L.x} ${POST_L.y} L${POST_R.x} ${POST_R.y} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      )
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <figure className="deck" aria-label={`${done} of ${total} saved`}>
      <svg viewBox="0 0 440 268" role="img" aria-hidden="true">
        <rect className="deck-shell" x="8" y="8" width="424" height="252" rx="18" />
        <rect className="deck-window" x="88" y="56" width="264" height="124" rx="62" />
        <g className={`deck-rec${active ? ' is-on' : ''}`}>
          <circle cx="36" cy="36" r="5" />
          <text x="48" y="40">{active ? 'REC' : 'IDLE'}</text>
        </g>
        <text className="deck-label" x="404" y="40" textAnchor="end">
          {label.length > 34 ? `${label.slice(0, 33)}…` : label}
        </text>
        {[L, R].map((c, i) => (
          <circle key={i} className="deck-flange" cx={c.x} cy={c.y} r={MAX + 4} />
        ))}
        <circle ref={packL} className="deck-pack" cx={L.x} cy={L.y} r={packRadius(1 - progress)} />
        <circle ref={packR} className="deck-pack" cx={R.x} cy={R.y} r={packRadius(progress)} />
        <path ref={tape} className="deck-tape" />
        {[
          { c: L, ref: hubL },
          { c: R, ref: hubR },
        ].map(({ c, ref }, i) => (
          <g key={i} ref={ref}>
            <circle className="deck-hub" cx={c.x} cy={c.y} r={HUB} />
            {[0, 120, 240].map((deg) => (
              <rect
                key={deg}
                className="deck-tooth"
                x={c.x - 2.5}
                y={c.y - HUB + 3}
                width="5"
                height="7"
                rx="1.5"
                transform={`rotate(${deg} ${c.x} ${c.y})`}
              />
            ))}
            <circle className="deck-axle" cx={c.x} cy={c.y} r="4" />
          </g>
        ))}
        <circle className="deck-post" cx={POST_L.x} cy={POST_L.y} r="5" />
        <circle className="deck-post" cx={POST_R.x} cy={POST_R.y} r="5" />
        <rect className="deck-head" x="196" y="206" width="48" height="14" rx="3" />
      </svg>
      <figcaption className="deck-counter">
        <span className="mono">{pad3(done)}</span>
        <span className="deck-slash">/</span>
        <span className="mono">{pad3(total)}</span>
      </figcaption>
    </figure>
  )
}
