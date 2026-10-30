import { spawnSync } from 'node:child_process'

// yt-dlp versions are dates (2026.08.19). YouTube changes often, so an old
// yt-dlp is the most common reason downloads start failing.
const STALE_AFTER_DAYS = 60

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 15_000, windowsHide: true })
  if (r.error || r.status !== 0) return null
  return r.stdout.trim()
}

function ageInDays(version) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version || '')
  if (!m) return null
  const released = Date.UTC(+m[1], +m[2] - 1, +m[3])
  return Math.floor((Date.now() - released) / 86_400_000)
}

export function detectTools() {
  const ytdlpBin = process.env.SPOOL_YTDLP || 'yt-dlp'
  const ffmpegBin = process.env.SPOOL_FFMPEG || 'ffmpeg'

  const ytdlpVersion = run(ytdlpBin, ['--version'])
  const ffmpegOut = run(ffmpegBin, ['-version'])
  const ffmpegVersion = ffmpegOut ? (/ffmpeg version (\S+)/.exec(ffmpegOut)?.[1] ?? 'unknown') : null
  const age = ageInDays(ytdlpVersion)

  return {
    ytdlp: {
      bin: ytdlpBin,
      ok: Boolean(ytdlpVersion),
      version: ytdlpVersion,
      stale: age !== null && age > STALE_AFTER_DAYS,
    },
    ffmpeg: {
      bin: ffmpegBin,
      ok: Boolean(ffmpegVersion),
      version: ffmpegVersion,
    },
  }
}
