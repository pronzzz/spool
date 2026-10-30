import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { cleanError } from './youtube.js'

export const FORMATS = {
  mp3: { kind: 'audio', qualities: ['320', '192', '128'] },
  m4a: { kind: 'audio', qualities: ['best'] },
  mp4: { kind: 'video', qualities: ['best', '1080', '720', '480', '360'] },
}

const MAX_ATTEMPTS = 3
const MAX_JOBS_KEPT = 20
const FLUSH_MS = 200

/** Folder-safe name that works on macOS, Windows and Linux. */
export function safeName(name) {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
  return clean || 'Untitled'
}

/** yt-dlp arguments for one video. Exported for tests. */
export function buildArgs({ id, index, numbered, format, quality, dir, hasFfmpeg, ffmpegBin }) {
  const prefix = numbered ? `${String(index).padStart(3, '0')} ` : ''
  const args = [
    '--newline',
    '--no-warnings',
    '--no-playlist',
    '--progress',
    '--progress-template',
    'download:SPOOL %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '--progress-template',
    'postprocess:SPOOLPP %(progress.postprocessor)s %(progress.status)s',
    '--print',
    'after_move:SPOOLFILE %(filepath)s',
    '--paths', dir,
    '--output', `${prefix}%(title)s.%(ext)s`,
    '--trim-filenames', '160',
    '--download-archive', path.join(dir, '.spool-archive'),
  ]

  if (ffmpegBin && ffmpegBin !== 'ffmpeg') args.push('--ffmpeg-location', ffmpegBin)

  if (format === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', `${quality}K`)
  } else if (format === 'm4a') {
    args.push('-f', 'ba[ext=m4a]/ba', '-x', '--audio-format', 'm4a')
  } else if (hasFfmpeg) {
    const h = quality === 'best' ? '' : `[height<=${quality}]`
    args.push('-f', `bv*${h}[ext=mp4]+ba[ext=m4a]/bv*${h}+ba/b${h}`, '--merge-output-format', 'mp4')
  } else {
    // Without ffmpeg only single-file streams work (usually 360p).
    args.push('-f', 'b[ext=mp4]/b')
  }

  if (hasFfmpeg) args.push('--embed-metadata', '--embed-thumbnail')
  args.push('--', `https://www.youtube.com/watch?v=${id}`)
  return args
}

const num = (s) => (s === 'NA' || s === 'None' || s === undefined ? null : Number(s))

/** Parses one "SPOOL downloaded total estimate speed eta" line. */
export function parseProgress(line) {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'SPOOL') return null
  const downloaded = num(parts[1]) ?? 0
  const total = num(parts[2]) ?? num(parts[3])
  return { downloaded, total, speed: num(parts[4]), eta: num(parts[5]) }
}

export class JobManager extends EventEmitter {
  constructor({ root, tools, concurrency = 3 }) {
    super()
    this.setMaxListeners(200)
    this.root = root
    this.tools = tools
    this.concurrency = concurrency
    this.jobs = new Map()
    this.queue = []
    this.active = 0
  }

  create({ title, kind, sourceUrl, items, format, quality }) {
    const dir = kind === 'playlist' ? path.join(this.root, safeName(title)) : this.root
    mkdirSync(dir, { recursive: true })

    const job = {
      id: randomUUID(),
      title,
      kind,
      sourceUrl,
      format,
      quality,
      dir,
      state: 'running',
      createdAt: Date.now(),
      finishedAt: null,
      numbered: kind === 'playlist',
      items: items.map((it) => ({
        id: it.id,
        index: it.index,
        title: it.title,
        state: 'queued',
        progress: 0,
        speed: null,
        eta: null,
        file: null,
        error: null,
        attempts: 0,
      })),
      procs: new Map(),
      dirty: new Set(),
      flushTimer: null,
    }

    this.jobs.set(job.id, job)
    this.prune()
    for (const item of job.items) this.queue.push({ job, item })
    this.pump()
    return job
  }

  get(id) {
    return this.jobs.get(id) || null
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => this.summary(j))
  }

  summary(job) {
    const counts = { queued: 0, active: 0, done: 0, skipped: 0, failed: 0, cancelled: 0 }
    let speed = 0
    for (const it of job.items) {
      if (it.state === 'downloading' || it.state === 'converting') {
        counts.active++
        speed += it.speed || 0
      } else counts[it.state]++
    }
    return {
      id: job.id,
      title: job.title,
      kind: job.kind,
      format: job.format,
      quality: job.quality,
      dir: job.dir,
      state: job.state,
      total: job.items.length,
      counts,
      speed,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    }
  }

  snapshot(job) {
    return { job: this.summary(job), items: job.items.map(publicItem) }
  }

  cancel(job) {
    if (job.state !== 'running') return
    job.state = 'cancelled'
    job.finishedAt = Date.now()
    this.queue = this.queue.filter((t) => t.job !== job)
    for (const it of job.items) {
      if (it.state === 'queued') {
        it.state = 'cancelled'
        this.touch(job, it)
      }
    }
    for (const proc of job.procs.values()) proc.kill()
    this.touch(job)
  }

  retry(job) {
    const again = job.items.filter((it) => it.state === 'failed' || it.state === 'cancelled')
    if (again.length === 0) return
    for (const it of again) {
      Object.assign(it, { state: 'queued', progress: 0, error: null, attempts: 0, speed: null, eta: null })
      this.queue.push({ job, item: it })
      this.touch(job, it)
    }
    job.state = 'running'
    job.finishedAt = null
    this.pump()
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const { job, item } = this.queue.shift()
      if (job.state !== 'running' || item.state !== 'queued') continue
      this.active++
      this.run(job, item).finally(() => {
        this.active--
        this.finishIfDone(job)
        this.pump()
      })
    }
  }

  run(job, item) {
    return new Promise((resolve) => {
      item.state = 'downloading'
      item.attempts++
      this.touch(job, item)

      const hasFfmpeg = this.tools.ffmpeg.ok
      const args = buildArgs({
        id: item.id,
        index: item.index,
        numbered: job.numbered,
        format: job.format,
        quality: job.quality,
        dir: job.dir,
        hasFfmpeg,
        ffmpegBin: this.tools.ffmpeg.bin,
      })
      // Video plus audio arrive as two separate downloads that ffmpeg merges.
      const streams = job.format === 'mp4' && hasFfmpeg ? 2 : 1
      let stream = 0
      let lastBytes = 0
      let stderr = ''
      let buffer = ''

      const proc = spawn(this.tools.ytdlp.bin, args, { windowsHide: true })
      job.procs.set(item.id, proc)

      const onLine = (line) => {
        if (line.startsWith('SPOOLFILE ')) {
          item.file = path.basename(line.slice(10).trim())
          return
        }
        if (line.startsWith('SPOOLPP ')) {
          const [, name, status] = line.trim().split(/\s+/)
          if (status === 'started' && name !== 'MoveFiles') {
            item.state = 'converting'
            item.speed = null
            item.eta = null
            this.touch(job, item)
          }
          return
        }
        const p = parseProgress(line)
        if (!p) return
        if (p.downloaded < lastBytes * 0.5 && stream < streams - 1) stream++
        lastBytes = p.downloaded
        const part = p.total ? Math.min(1, p.downloaded / p.total) : 0
        item.progress = Math.max(item.progress, Math.min(99, Math.round(((stream + part) / streams) * 100)))
        item.speed = p.speed
        item.eta = p.eta
        this.touch(job, item)
      }

      proc.stdout.on('data', (chunk) => {
        buffer += chunk
        let nl
        while ((nl = buffer.indexOf('\n')) !== -1) {
          onLine(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
        }
      })
      proc.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000) })

      const done = (code) => {
        job.procs.delete(item.id)
        item.speed = null
        item.eta = null
        if (job.state === 'cancelled') {
          item.state = 'cancelled'
        } else if (code === 0) {
          item.state = item.file ? 'done' : 'skipped'
          item.progress = 100
        } else if (item.attempts < MAX_ATTEMPTS) {
          item.state = 'queued'
          item.progress = 0
          setTimeout(() => {
            this.queue.unshift({ job, item })
            this.pump()
          }, 1500 * item.attempts)
        } else {
          item.state = 'failed'
          item.error = cleanError(stderr) || `yt-dlp exited with code ${code}`
        }
        this.touch(job, item)
        resolve()
      }

      proc.on('error', (err) => {
        stderr += `ERROR: ${err.message}`
        done(1)
      })
      proc.on('close', done)
    })
  }

  finishIfDone(job) {
    if (job.state !== 'running') return
    const pending = job.items.some((it) => it.state === 'queued' || it.state === 'downloading' || it.state === 'converting')
    if (pending) return
    job.state = 'done'
    job.finishedAt = Date.now()
    this.touch(job)
  }

  /** Marks an item changed; changes go out together every FLUSH_MS. */
  touch(job, item) {
    if (item) job.dirty.add(item)
    if (job.flushTimer) return
    job.flushTimer = setTimeout(() => {
      job.flushTimer = null
      const items = [...job.dirty].map(publicItem)
      job.dirty.clear()
      this.emit(`patch:${job.id}`, { job: this.summary(job), items })
    }, FLUSH_MS)
  }

  prune() {
    const finished = [...this.jobs.values()]
      .filter((j) => j.state !== 'running')
      .sort((a, b) => a.createdAt - b.createdAt)
    while (this.jobs.size > MAX_JOBS_KEPT && finished.length) this.jobs.delete(finished.shift().id)
  }
}

function publicItem(it) {
  const { attempts, ...rest } = it
  return rest
}
