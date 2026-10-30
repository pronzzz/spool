import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUrl, shapeInfo, cleanError, UserError } from '../youtube.js'
import { buildArgs, parseProgress, safeName } from '../jobs.js'
import { createServer, isAllowedOrigin, validateJob } from '../server.js'

const tools = { ytdlp: { ok: true, bin: 'yt-dlp' }, ffmpeg: { ok: true, bin: 'ffmpeg' } }

test('normalizeUrl accepts YouTube links only', () => {
  assert.equal(normalizeUrl('https://www.youtube.com/playlist?list=PL123'), 'https://www.youtube.com/playlist?list=PL123')
  assert.equal(normalizeUrl(' http://youtu.be/jNQXAC9IVRw#t=3 '), 'https://youtu.be/jNQXAC9IVRw')
  assert.equal(normalizeUrl('https://music.youtube.com/watch?v=jNQXAC9IVRw'), 'https://music.youtube.com/watch?v=jNQXAC9IVRw')
  assert.equal(normalizeUrl('https://evil.com/?u=youtube.com'), null)
  assert.equal(normalizeUrl('https://youtube.com.evil.com/watch'), null)
  assert.equal(normalizeUrl('file:///etc/passwd'), null)
  assert.equal(normalizeUrl('--exec rm'), null)
  assert.equal(normalizeUrl(42), null)
})

test('shapeInfo shapes playlists and marks unavailable entries', () => {
  const out = shapeInfo(
    {
      _type: 'playlist',
      id: 'PL1',
      title: 'Mix',
      channel: 'Someone',
      entries: [
        { id: 'aaaaaaaaaaa', title: 'One', duration: 61.4, ie_key: 'Youtube' },
        { id: 'bbbbbbbbbbb', title: '[Private video]', duration: null, ie_key: 'Youtube' },
        { id: 'bad', title: 'Bad' },
      ],
    },
    'https://www.youtube.com/playlist?list=PL1',
  )
  assert.equal(out.kind, 'playlist')
  assert.equal(out.items.length, 2)
  assert.deepEqual(out.items[0], { id: 'aaaaaaaaaaa', index: 1, title: 'One', channel: null, duration: 61, unavailable: false })
  assert.equal(out.items[1].unavailable, true)
})

test('shapeInfo explains channel links', () => {
  assert.throws(
    () => shapeInfo({ _type: 'playlist', entries: [{ id: 'UCxyz', ie_key: 'YoutubeTab', _type: 'url' }] }, 'u'),
    (err) => err instanceof UserError && /Videos tab/.test(err.message),
  )
})

test('shapeInfo shapes single videos', () => {
  const out = shapeInfo({ id: 'jNQXAC9IVRw', title: 'Me at the zoo', duration: 19, uploader: 'jawed' }, 'u')
  assert.equal(out.kind, 'video')
  assert.equal(out.channel, 'jawed')
  assert.equal(out.items.length, 1)
})

test('cleanError keeps the last yt-dlp error line', () => {
  const stderr = 'WARNING: x\nERROR: [youtube] abcdefghijk: Video unavailable\n'
  assert.equal(cleanError(stderr), 'Video unavailable')
})

test('parseProgress reads the progress template', () => {
  assert.deepEqual(parseProgress('SPOOL 1024 4096 NA 2048.5 3'), { downloaded: 1024, total: 4096, speed: 2048.5, eta: 3 })
  assert.deepEqual(parseProgress('SPOOL 10 NA 100 NA NA'), { downloaded: 10, total: 100, speed: null, eta: null })
  assert.equal(parseProgress('[download] 10%'), null)
})

test('buildArgs ends with a fixed watch URL after --', () => {
  const args = buildArgs({ id: 'jNQXAC9IVRw', index: 7, numbered: true, format: 'mp3', quality: '192', dir: '/tmp/x', hasFfmpeg: true, ffmpegBin: 'ffmpeg' })
  assert.deepEqual(args.slice(-2), ['--', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'])
  assert.ok(args.includes('007 %(title)s.%(ext)s'))
  assert.ok(args.includes('192K'))
  const video = buildArgs({ id: 'jNQXAC9IVRw', index: 1, numbered: false, format: 'mp4', quality: '720', dir: '/tmp/x', hasFfmpeg: false })
  assert.ok(video.includes('b[ext=mp4]/b'))
  assert.ok(!video.includes('--embed-thumbnail'))
})

test('safeName strips path characters', () => {
  assert.equal(safeName('../../etc/passwd'), 'etc passwd')
  assert.equal(safeName('  Lo-fi: beats / study?  '), 'Lo-fi beats study')
  assert.equal(safeName(''), 'Untitled')
})

test('origins: hosted sites and localhost only', () => {
  assert.ok(isAllowedOrigin('https://getspool.vercel.app'))
  assert.ok(isAllowedOrigin('http://localhost:5173'))
  assert.ok(isAllowedOrigin('http://127.0.0.1:7317'))
  assert.ok(!isAllowedOrigin('https://evil.example'))
  assert.ok(!isAllowedOrigin('http://localhost.evil.example'))
  assert.ok(isAllowedOrigin('https://mine.example', ['https://mine.example']))
})

test('validateJob cleans input', () => {
  const job = validateJob(
    {
      title: 'Mix',
      kind: 'playlist',
      format: 'mp4',
      quality: '720',
      items: [{ id: 'aaaaaaaaaaa', index: 3, title: 'A' }, { id: 'aaaaaaaaaaa' }, { id: '; rm -rf /' }],
    },
    tools,
  )
  assert.equal(job.items.length, 1)
  assert.equal(job.items[0].index, 3)
  assert.throws(() => validateJob({ kind: 'video', format: 'mp3', quality: '999', items: [] }, tools), UserError)
  assert.throws(
    () => validateJob({ kind: 'video', format: 'mp3', quality: '320', items: [{ id: 'aaaaaaaaaaa' }] }, { ...tools, ffmpeg: { ok: false } }),
    /ffmpeg/,
  )
})

test('server rejects foreign origins and hosts', async () => {
  const server = createServer({ root: '/tmp/spool-test', tools, version: 'test', concurrency: 1 })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const ok = await fetch(`${base}/api/health`, { headers: { Origin: 'https://getspool.vercel.app' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://getspool.vercel.app')
    assert.equal((await ok.json()).app, 'spool')

    const bad = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } })
    assert.equal(bad.status, 403)

    const preflight = await fetch(`${base}/api/inspect`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://getspool.web.app', 'Access-Control-Request-Private-Network': 'true' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true')

    const inspect = await fetch(`${base}/api/inspect`, { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })
    assert.equal(inspect.status, 400)
  } finally {
    server.close()
  }
})
