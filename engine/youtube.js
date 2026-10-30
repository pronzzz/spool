import { spawn } from 'node:child_process'

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
])

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
export const MAX_ITEMS = 2000

/** Returns a clean https URL for YouTube links, or null for anything else. */
export function normalizeUrl(input) {
  if (typeof input !== 'string') return null
  let url
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!HOSTS.has(url.hostname.toLowerCase())) return null
  url.protocol = 'https:'
  url.hash = ''
  return url.toString()
}

const UNAVAILABLE = /^\[(private|deleted|unavailable)/i

function toItem(entry, index) {
  return {
    id: entry.id,
    index,
    title: entry.title || 'Untitled',
    channel: entry.channel || entry.uploader || null,
    duration: typeof entry.duration === 'number' ? Math.round(entry.duration) : null,
    unavailable: UNAVAILABLE.test(entry.title || '') || entry.availability === 'needs_auth',
  }
}

/** Shapes yt-dlp's -J output into what the UI needs. Exported for tests. */
export function shapeInfo(info, url) {
  if (info._type === 'playlist') {
    const entries = info.entries || []
    const videos = entries.filter((e) => e && VIDEO_ID.test(e.id || '') && e.ie_key !== 'YoutubeTab')
    if (videos.length === 0 && entries.some((e) => e?.ie_key === 'YoutubeTab')) {
      throw new UserError('That link is a whole channel. Open its Videos tab and paste that link instead.')
    }
    if (videos.length === 0) throw new UserError('That playlist is empty or private.')
    if (videos.length > MAX_ITEMS) {
      throw new UserError(`That playlist has ${videos.length} videos. Spool handles up to ${MAX_ITEMS} at a time.`)
    }
    return {
      kind: 'playlist',
      id: info.id,
      url,
      title: info.title || 'Untitled playlist',
      channel: info.channel || info.uploader || null,
      items: videos.map((e, i) => toItem(e, i + 1)),
    }
  }

  if (!VIDEO_ID.test(info.id || '')) throw new UserError('Spool could not find a video at that link.')
  return {
    kind: 'video',
    id: info.id,
    url,
    title: info.title || 'Untitled',
    channel: info.channel || info.uploader || null,
    items: [toItem(info, 1)],
  }
}

export class UserError extends Error {
  status = 400
}

/** Reads metadata for a video or playlist without downloading anything. */
export function inspect(url, tools) {
  return new Promise((resolve, reject) => {
    const args = ['-J', '--flat-playlist', '--no-warnings', '--', url]
    const proc = spawn(tools.ytdlp.bin, args, { windowsHide: true })
    const chunks = []
    let stderr = ''
    const timer = setTimeout(() => proc.kill(), 120_000)

    proc.stdout.on('data', (c) => chunks.push(c))
    proc.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000) })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Could not run yt-dlp (${err.message}).`))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new UserError(cleanError(stderr) || 'yt-dlp could not read that link.'))
      try {
        resolve(shapeInfo(JSON.parse(Buffer.concat(chunks).toString('utf8')), url))
      } catch (err) {
        reject(err instanceof UserError ? err : new Error('yt-dlp returned something Spool could not read.'))
      }
    })
  })
}

/** Turns yt-dlp's stderr into one readable sentence. */
export function cleanError(stderr) {
  const lines = String(stderr).split('\n').map((l) => l.trim()).filter(Boolean)
  const line = lines.reverse().find((l) => l.startsWith('ERROR:')) || lines[0] || ''
  return line
    .replace(/^ERROR:\s*/, '')
    .replace(/^\[[^\]]+\]\s*[A-Za-z0-9_-]+:\s*/, '')
    .slice(0, 300)
}
