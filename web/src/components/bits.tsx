import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

/** Words blur into focus one after another (after React Bits' BlurText). */
export function BlurText({ text, as: Tag = 'h1', className }: { text: ReactNode[]; as?: 'h1' | 'h2'; className?: string }) {
  return (
    <Tag className={className}>
      {text.map((word, i) => (
        <Fragment key={i}>
          <span className="blur-word" style={{ animationDelay: `${120 + i * 70}ms` }}>
            {word}
          </span>
          {i < text.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </Tag>
  )
}

/** Adds `is-in` once the element scrolls into view. */
export function Reveal({ children, className = '', as: Tag = 'div', id }: { children: ReactNode; className?: string; as?: 'div' | 'section'; id?: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-in')
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref as never} id={id} className={`reveal ${className}`}>
      {children}
    </Tag>
  )
}

/** Gently pulls toward the pointer (after React Bits' Magnet). */
export function useMagnet<T extends HTMLElement>(strength = 0.18) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const x = (e.clientX - (r.left + r.width / 2)) * strength
      const y = (e.clientY - (r.top + r.height / 2)) * strength
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    }
    const leave = () => {
      el.style.transform = ''
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [strength])
  return ref
}

export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className="cmd">
      {label && <span className="cmd-label">{label}</span>}
      <code className="cmd-text">
        <span className="cmd-prompt" aria-hidden="true">
          $
        </span>
        {command}
      </code>
      <button
        type="button"
        className={`cmd-copy${copied ? ' is-copied' : ''}`}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => setCopied(true))
        }}
        aria-label={copied ? 'Copied' : `Copy: ${command}`}
      >
        <span className="cmd-copy-a">Copy</span>
        <span className="cmd-copy-b">Copied</span>
      </button>
    </div>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="8.5" fill="currentColor" opacity="0.18" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
      <circle cx="26.5" cy="26.5" r="3.4" className="logo-dot" />
    </svg>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(() => document.documentElement.dataset.theme ?? null)
  const isDark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={isDark ? 'Use light theme' : 'Use dark theme'}
      onClick={() => {
        const next = isDark ? 'light' : 'dark'
        document.documentElement.dataset.theme = next
        try {
          localStorage.setItem('spool.theme', next)
        } catch {
          /* fine */
        }
        setTheme(next)
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
      </svg>
    </button>
  )
}
