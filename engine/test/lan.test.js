import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Gate, newCode, loadCode, isLoopback, CODE_LENGTH } from '../lan.js'
import { buildArgs, TIDY_TAGS } from '../jobs.js'
import { cleanQuery } from '../youtube.js'
import { createServer } from '../server.js'
import http from 'node:http'

/** fetch() won't send a custom Host header, so spoofed-host checks use node:http. */
function statusWithHost(port, urlPath, host, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, headers: { ...headers, Host: host } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    }).on('error', reject)
  })
}

test('pairing codes are short, readable and persistent', () => {
  const code = newCode()
  assert.equal(code.length, CODE_LENGTH)
  assert.match(code, /^[A-HJ-NP-Z2-9]+$/)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spool-code-'))
  const first = loadCode({ dir })
  assert.equal(loadCode({ dir }), first)
  assert.notEqual(loadCode({ dir, reset: true }), undefined)
})

test('gate accepts the code and locks out guessers', () => {
  let t = 0
  const gate = new Gate('ABC234', { maxFailures: 3, lockMs: 1000, now: () => t })
  assert.equal(gate.check('1.1.1.1', 'Bearer abc234'), 'ok')
  assert.equal(gate.check('1.1.1.1', 'Bearer WRONG1'), 'bad')
  assert.equal(gate.check('1.1.1.1', 'nope'), 'bad')
  assert.equal(gate.check('1.1.1.1', ''), 'locked')
  assert.equal(gate.check('1.1.1.1', 'Bearer ABC234'), 'locked') // even the right code, while locked
  assert.equal(gate.check('2.2.2.2', 'Bearer ABC234'), 'ok') // others are unaffected
  t = 2000
  assert.equal(gate.check('1.1.1.1', 'Bearer ABC234'), 'ok')
})

test('loopback detection', () => {
  assert.ok(isLoopback('127.0.0.1'))
  assert.ok(isLoopback('::ffff:127.0.0.1'))
  assert.ok(!isLoopback('192.168.1.20'))
})

test('cleanQuery trims and rejects empty searches', () => {
  assert.equal(cleanQuery('  daft\n punk '), 'daft punk')
  assert.equal(cleanQuery('   '), null)
  assert.equal(cleanQuery(5), null)
  assert.equal(cleanQuery('x'.repeat(500)).length, 200)
})

test('LAN downloads skip the archive and tidy audio tags', () => {
  const base = { id: 'jNQXAC9IVRw', index: 1, numbered: false, quality: 'best', dir: '/tmp/x', hasFfmpeg: true }
  const lan = buildArgs({ ...base, format: 'm4a', archive: false, tidy: true })
  assert.ok(!lan.includes('--download-archive'))
  assert.ok(lan.includes(TIDY_TAGS[0]))
  assert.deepEqual(lan.slice(-2), ['--', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'])
  const web = buildArgs({ ...base, format: 'm4a' })
  assert.ok(web.includes('--download-archive'))
  assert.ok(!web.includes(TIDY_TAGS[0]))
})

/** A stand-in for yt-dlp that "downloads" by writing a small file. */
function fakeYtDlp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spool-fake-'))
  const bin = path.join(dir, 'yt-dlp')
  writeFileSync(bin, `#!/usr/bin/env node
const a = process.argv.slice(2)
const url = a[a.length - 1]
if (a.includes('-J')) {
  console.log(JSON.stringify({ _type: 'playlist', entries: [{ id: 'aaaaaaaaaaa', title: 'Song A', channel: 'Band', duration: 200, ie_key: 'Youtube' }] }))
  process.exit(0)
}
const dir = a[a.indexOf('--paths') + 1]
const file = require('path').join(dir, url.slice(-11) + '.m4a')
require('fs').writeFileSync(file, 'AUDIO')
console.log('SPOOL 5 5 NA 100 0')
console.log('SPOOLFILE ' + file)
`)
  chmodSync(bin, 0o755)
  return bin
}

test('a paired phone can search, download and collect a file', async () => {
  const ytdlp = fakeYtDlp()
  const tools = { ytdlp: { ok: true, bin: ytdlp }, ffmpeg: { ok: true, bin: 'ffmpeg' } }
  const lanDir = mkdtempSync(path.join(os.tmpdir(), 'spool-lan-'))
  const server = createServer({
    root: mkdtempSync(path.join(os.tmpdir(), 'spool-root-')),
    tools, version: 'test', concurrency: 1,
    lan: { gate: new Gate('ABC234'), name: 'Test Mac', dir: lanDir },
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}/api/lan`
  const auth = { Authorization: 'Bearer ABC234' }
  try {
    assert.equal((await fetch(`${base}/hello`)).status, 401)
    assert.equal((await fetch(`${base}/hello`, { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403)
    const hello = await (await fetch(`${base}/hello`, { headers: auth })).json()
    assert.equal(hello.name, 'Test Mac')
    assert.deepEqual(hello.formats, ['m4a', 'mp3'])

    const found = await (await fetch(`${base}/search?q=song`, { headers: auth })).json()
    assert.equal(found.kind, 'search')
    assert.equal(found.items[0].id, 'aaaaaaaaaaa')
    assert.equal((await fetch(`${base}/search?q=%20`, { headers: auth })).status, 400)

    const mp4 = await fetch(`${base}/jobs`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'x', kind: 'video', format: 'mp4', quality: 'best', items: [{ id: 'aaaaaaaaaaa' }] }),
    })
    assert.equal(mp4.status, 400)

    const created = await (await fetch(`${base}/jobs`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'Song A', kind: 'video', format: 'm4a', quality: 'best', items: [{ id: 'aaaaaaaaaaa', title: 'Song A' }] }),
    })).json()
    const id = created.job.id
    let snap
    for (let i = 0; i < 50; i++) {
      snap = await (await fetch(`${base}/jobs/${id}`, { headers: auth })).json()
      if (snap.job.state === 'done') break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(snap.items[0].state, 'done')
    assert.equal(snap.items[0].file, 'aaaaaaaaaaa.m4a')

    const file = await fetch(`${base}/jobs/${id}/files/aaaaaaaaaaa`, { headers: auth })
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'audio/mp4')
    assert.equal(await file.text(), 'AUDIO')

    const onDisk = path.join(snap.job.dir, 'aaaaaaaaaaa.m4a')
    assert.ok(onDisk.startsWith(lanDir) && existsSync(onDisk))
    assert.equal((await fetch(`${base}/jobs/${id}/files/aaaaaaaaaaa`, { method: 'DELETE', headers: auth })).status, 200)
    assert.ok(!existsSync(onDisk))

    // The full API stays closed to anything that isn't this computer asking for localhost.
    assert.equal(await statusWithHost(server.address().port, '/api/jobs', '192.168.1.9:7317', auth), 404)
    assert.equal(await statusWithHost(server.address().port, '/api/jobs', '192.168.1.9:7317'), 401)
  } finally {
    server.close()
  }
})

test('without LAN mode, LAN routes and foreign hosts are refused', async () => {
  const tools = { ytdlp: { ok: true, bin: 'yt-dlp' }, ffmpeg: { ok: true, bin: 'ffmpeg' } }
  const server = createServer({ root: '/tmp/spool-test', tools, version: 'test', concurrency: 1 })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/lan/hello`, { headers: { Authorization: 'Bearer X' } })).status, 421)
    assert.equal(await statusWithHost(port, '/api/health', 'evil.example'), 421)
    assert.equal(await statusWithHost(port, '/api/health', 'localhost'), 200)
  } finally {
    server.close()
  }
})
