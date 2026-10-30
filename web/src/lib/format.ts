import type { Format } from './types'

export function duration(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function longDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h) return `${h} h ${m} min`
  return `${m} min`
}

export function speed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond) return ''
  const mb = bytesPerSecond / 1_000_000
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1000)} kB/s`
}

export const pad3 = (n: number) => String(Math.max(0, Math.min(999, n))).padStart(3, '0')

export const QUALITIES: Record<Format, { value: string; label: string }[]> = {
  mp3: [
    { value: '320', label: '320 kbps' },
    { value: '192', label: '192 kbps' },
    { value: '128', label: '128 kbps' },
  ],
  m4a: [{ value: 'best', label: 'Original' }],
  mp4: [
    { value: 'best', label: 'Best' },
    { value: '1080', label: '1080p' },
    { value: '720', label: '720p' },
    { value: '480', label: '480p' },
    { value: '360', label: '360p' },
  ],
}

export const FORMAT_NOTES: Record<Format, string> = {
  mp3: 'Audio, tagged with title, artist and cover art.',
  m4a: 'Audio exactly as YouTube serves it. No re-encoding, fastest.',
  mp4: 'Video with sound, merged into one file.',
}

export function thumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

/** Stable hue for demo artwork. */
export function hue(id: string): number {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  // Final mix so ids that differ in one letter land far apart.
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) % 360
}
