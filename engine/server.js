import http from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect, search, cleanQuery, normalizeUrl, VIDEO_ID, MAX_ITEMS, UserError } from './youtube.js'
import { FORMATS, JobManager } from './jobs.js'
import { isLoopback } from './lan.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(here, '../dist')

// The hosted sites may talk to the engine. Any localhost page may too (the
// engine's own UI and the dev server).
export const HOSTED_ORIGINS = [
  'https://getspool.vercel.app',
  'https://getspool.web.app',
  'https://getspool.firebaseapp.com',
]
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export function isAllowedOrigin(origin, extra = []) {
  return LOCAL_ORIGIN.test(origin) || HOSTED_ORIGINS.includes(origin) || extra.includes(origin)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

const AUDIO_TYPES = { '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.opus': 'audio/ogg', '.webm': 'audio/webm', '.mp4': 'video/mp4' }

/**
 * `lan` (optional) turns on LAN mode: { gate, name, dir } where gate checks the pairing code
 * and dir is a private folder for phone downloads, emptied as the phone collects them.
 */
export function createServer({ root, tools, version, concurrency, allowOrigins = [], lan = null }) {
  const jobs = new JobManager({ root, tools, concurrency })
  if (lan) jobs.on('pruned', (job) => { if (job.lan) rm(job.dir, { recursive: true, force: true }).catch(() => {}) })

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      // DNS-rebinding guard: the full API only answers this computer, addressed as localhost.
      const fromThisComputer = isLoopback(req.socket.remoteAddress) && LOCAL_HOST.test(req.headers.host || '')

      // Phones on the LAN: pairing code required, and only the /api/lan/ routes.
      if (url.pathname.startsWith('/api/lan/') || !fromThisComputer) {
        if (!lan) return send(res, 421, { error: 'Wrong host.' })
        return await lanApi(req, res, url)
      }

      const origin = req.headers.origin
      if (origin) {
        if (!isAllowedOrigin(origin, allowOrigins)) return send(res, 403, { error: 'Origin not allowed.' })
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        res.setHeader('Access-Control-Max-Age', '600')
        if (req.headers['access-control-request-private-network']) {
          res.setHeader('Access-Control-Allow-Private-Network', 'true')
        }
        res.writeHead(204).end()
        return
      }

      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      return await serveStatic(res, url.pathname)
    } catch (err) {
      const status = err instanceof UserError ? 400 : err.status || 500
      if (status === 500) console.error(err)
      if (!res.headersSent) send(res, status, { error: err.message || 'Something went wrong.' })
      else res.end()
    }
  })

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"
    const method = req.method

    if (method === 'GET' && parts[0] === 'health') {
      return send(res, 200, { app: 'spool', version, dir: root, concurrency: jobs.concurrency, tools })
    }

    if (method === 'POST' && parts[0] === 'inspect') {
      requireTool(tools.ytdlp, 'yt-dlp')
      const body = await readJson(req)
      const clean = normalizeUrl(body.url)
      if (!clean) throw new UserError('Paste a YouTube video or playlist link.')
      return send(res, 200, await inspect(clean, tools))
    }

    if (parts[0] !== 'jobs') return send(res, 404, { error: 'Not found.' })

    if (parts.length === 1 && method === 'GET') return send(res, 200, { jobs: jobs.list() })
    if (parts.length === 1 && method === 'POST') {
      requireTool(tools.ytdlp, 'yt-dlp')
      const input = validateJob(await readJson(req), tools)
      const job = jobs.create(input)
      return send(res, 201, jobs.snapshot(job))
    }

    const job = jobs.get(parts[1])
    if (!job) return send(res, 404, { error: 'That job is gone. The engine may have restarted.' })

    if (parts.length === 2 && method === 'GET') return send(res, 200, jobs.snapshot(job))
    if (parts[2] === 'events' && method === 'GET') return stream(req, res, job)
    if (method === 'POST' && parts[2] === 'cancel') {
      jobs.cancel(job)
      return send(res, 200, { ok: true })
    }
    if (method === 'POST' && parts[2] === 'retry') {
      jobs.retry(job)
      return send(res, 200, { ok: true })
    }
    if (method === 'POST' && parts[2] === 'reveal') {
      reveal(job.dir)
      return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'Not found.' })
  }

  async function lanApi(req, res, url) {
    // Browsers never need these routes; refusing them keeps web pages on the LAN out.
    if (req.headers.origin) return send(res, 403, { error: 'Origin not allowed.' })
    const verdict = lan.gate.check(req.socket.remoteAddress, req.headers.authorization)
    if (verdict === 'locked') return send(res, 429, { error: 'Too many wrong codes. Try again in 10 minutes.' })
    if (verdict !== 'ok') return send(res, 401, { error: 'Wrong pairing code.' })

    if (!url.pathname.startsWith('/api/lan/')) return send(res, 404, { error: 'Not found.' })
    const parts = url.pathname.split('/').filter(Boolean).slice(2) // drop "api", "lan"
    const method = req.method

    if (method === 'GET' && parts[0] === 'hello') {
      return send(res, 200, {
        app: 'spool',
        version,
        name: lan.name,
        ytdlp: tools.ytdlp.ok,
        ffmpeg: tools.ffmpeg.ok,
        formats: tools.ffmpeg.ok ? ['m4a', 'mp3'] : [],
      })
    }

    if (method === 'GET' && parts[0] === 'search') {
      requireTool(tools.ytdlp, 'yt-dlp')
      const q = cleanQuery(url.searchParams.get('q'))
      if (!q) throw new UserError('Type something to search for.')
      return send(res, 200, await search(q, url.searchParams.get('limit'), tools))
    }

    if (method === 'POST' && parts[0] === 'inspect') {
      requireTool(tools.ytdlp, 'yt-dlp')
      const clean = normalizeUrl((await readJson(req)).url)
      if (!clean) throw new UserError('That is not a YouTube link.')
      return send(res, 200, await inspect(clean, tools))
    }

    if (parts[0] !== 'jobs') return send(res, 404, { error: 'Not found.' })

    if (parts.length === 1 && method === 'POST') {
      requireTool(tools.ytdlp, 'yt-dlp')
      const input = validateJob(await readJson(req), tools)
      if (FORMATS[input.format].kind !== 'audio') throw new UserError('Phones get audio only: m4a or mp3.')
      // Encoding needs ffmpeg; without it m4a would arrive untagged and without a cover.
      if (!tools.ffmpeg.ok) throw new UserError('Install ffmpeg on the computer, then restart Spool.')
      const job = jobs.create({ ...input, dir: path.join(lan.dir, randomId()), archive: false, tidy: true, lan: true })
      return send(res, 201, jobs.snapshot(job))
    }

    const job = jobs.get(parts[1])
    if (!job || !job.lan) return send(res, 404, { error: 'That download is gone. Spool may have restarted.' })

    if (parts.length === 2 && method === 'GET') return send(res, 200, jobs.snapshot(job))
    if (parts.length === 3 && parts[2] === 'cancel' && method === 'POST') {
      jobs.cancel(job)
      return send(res, 200, { ok: true })
    }

    if (parts[2] === 'files' && parts.length === 4) {
      const item = job.items.find((it) => it.id === parts[3])
      if (!item || item.state !== 'done' || !item.file) return send(res, 404, { error: 'Not ready.' })
      const file = path.join(job.dir, path.basename(item.file))
      if (method === 'DELETE') {
        // The phone has saved it; the computer's copy was only for collecting.
        await rm(file, { force: true })
        item.collected = true
        return send(res, 200, { ok: true })
      }
      if (method !== 'GET') return send(res, 405, { error: 'Method not allowed.' })
      const info = await stat(file).catch(() => null)
      if (!info) return send(res, 404, { error: 'The file is gone.' })
      res.writeHead(200, {
        'Content-Type': AUDIO_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
        'Cache-Control': 'no-store',
      })
      createReadStream(file).on('error', () => res.destroy()).pipe(res)
      return
    }
    return send(res, 404, { error: 'Not found.' })
  }

  function stream(req, res, job) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    write('snapshot', jobs.snapshot(job))
    const onPatch = (patch) => write('patch', patch)
    jobs.on(`patch:${job.id}`, onPatch)
    const beat = setInterval(() => res.write(': beat\n\n'), 15_000)
    req.on('close', () => {
      clearInterval(beat)
      jobs.off(`patch:${job.id}`, onPatch)
    })
  }

  async function serveStatic(res, pathname) {
    let file = path.join(WEB_ROOT, path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, ''))
    if (!file.startsWith(WEB_ROOT)) return send(res, 403, { error: 'Forbidden.' })
    let info = await stat(file).catch(() => null)
    if (!info || info.isDirectory()) {
      file = path.join(WEB_ROOT, 'index.html')
      info = await stat(file).catch(() => null)
    }
    if (!info) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Spool engine is running. Build the web app with `npm run build` to use it here.')
    }
    const ext = path.extname(file)
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(await readFile(file))
  }

  server.jobs = jobs
  return server
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function requireTool(tool, name) {
  if (!tool.ok) {
    const err = new Error(`${name} is not installed. Install it, then restart the engine.`)
    err.status = 503
    throw err
  }
}

export function validateJob(body, tools) {
  const { title, kind, sourceUrl, items, format, quality } = body || {}
  const spec = FORMATS[format]
  if (!spec) throw new UserError('Unknown format.')
  if (!spec.qualities.includes(String(quality))) throw new UserError('Unknown quality.')
  if (format === 'mp3' && !tools.ffmpeg.ok) throw new UserError('MP3 needs ffmpeg. Install it, or pick M4A.')
  if (kind !== 'playlist' && kind !== 'video') throw new UserError('Unknown source.')
  if (!Array.isArray(items) || items.length === 0) throw new UserError('Pick at least one video.')
  if (items.length > MAX_ITEMS) throw new UserError(`Spool handles up to ${MAX_ITEMS} videos at a time.`)
  const seen = new Set()
  const clean = []
  for (const it of items) {
    if (!VIDEO_ID.test(it?.id || '') || seen.has(it.id)) continue
    seen.add(it.id)
    clean.push({
      id: it.id,
      index: Number.isInteger(it.index) && it.index > 0 ? it.index : clean.length + 1,
      title: String(it.title || it.id).slice(0, 300),
    })
  }
  if (clean.length === 0) throw new UserError('None of those videos look valid.')
  return {
    title: String(title || 'Untitled').slice(0, 300),
    kind,
    sourceUrl: normalizeUrl(sourceUrl) || null,
    items: clean,
    format,
    quality: String(quality),
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 2_000_000) {
        reject(new UserError('Request too large.'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new UserError('Request body must be JSON.'))
      }
    })
    req.on('error', reject)
  })
}

export function reveal(dir) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [dir]]
    : process.platform === 'win32' ? ['explorer', [dir]]
    : ['xdg-open', [dir]]
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
}
