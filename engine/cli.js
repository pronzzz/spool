#!/usr/bin/env node
import { readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { detectTools } from './tools.js'
import { createServer } from './server.js'
import { Gate, computerName, lanAddresses, loadCode, startDiscovery } from './lan.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8'))

const HELP = `
  spool ${version} — wind YouTube playlists onto your disk

  Usage
    npx spool [options]       start the engine and open Spool
    npx spool doctor          check yt-dlp and ffmpeg

  Options
    --port <n>          port to listen on (default 7317)
    --dir <path>        where files go (default ~/Downloads/Spool)
    --concurrency <n>   downloads at once, 1–8 (default 3)
    --allow-origin <u>  also accept requests from this site
    --lan               let phones on your Wi-Fi use Spool (Wheelhouse)
    --new-code          with --lan: make a new pairing code
    --no-open           don't open the browser
    -v, --version
    -h, --help
`

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: process.env.SPOOL_PORT || '7317' },
      dir: { type: 'string', default: process.env.SPOOL_DIR || path.join(homedir(), 'Downloads', 'Spool') },
      concurrency: { type: 'string', default: '3' },
      'allow-origin': { type: 'string', multiple: true, default: [] },
      'no-open': { type: 'boolean', default: false },
      lan: { type: 'boolean', default: false },
      'new-code': { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  })
} catch (err) {
  console.error(`\n  ${err.message}\n${HELP}`)
  process.exit(1)
}

const { values: opts, positionals } = parsed
if (opts.help) {
  console.log(HELP)
  process.exit(0)
}
if (opts.version) {
  console.log(version)
  process.exit(0)
}

const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s)
const accent = (s) => (process.stdout.isTTY ? `\x1b[38;2;255;90;31m${s}\x1b[0m` : s)
const tilde = (p) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p)

const tools = detectTools()
const toolLine = (t, name) =>
  t.ok ? `${t.version}${t.stale ? accent('  (old — update it)') : ''}` : accent(`missing — install ${name}`)

const INSTALL_HINT = {
  darwin: 'brew install yt-dlp ffmpeg',
  win32: 'winget install yt-dlp.yt-dlp Gyan.FFmpeg',
  linux: 'pipx install yt-dlp  &&  sudo apt install ffmpeg',
}[process.platform] || 'see https://github.com/yt-dlp/yt-dlp#installation'

function printTools() {
  console.log(`    yt-dlp   ${toolLine(tools.ytdlp, 'yt-dlp')}`)
  console.log(`    ffmpeg   ${toolLine(tools.ffmpeg, 'ffmpeg')}`)
  if (!tools.ytdlp.ok || !tools.ffmpeg.ok) console.log(dim(`\n    install: ${INSTALL_HINT}`))
}

if (positionals[0] === 'doctor') {
  console.log(`\n  ${accent('spool')} ${version}\n`)
  printTools()
  console.log()
  process.exit(tools.ytdlp.ok ? 0 : 1)
}

const port = Number(opts.port)
const concurrency = Math.min(8, Math.max(1, Number(opts.concurrency) || 3))
const root = path.resolve(opts.dir)
const local = `http://localhost:${port}`

let lan = null
if (opts.lan) {
  const dir = path.join(tmpdir(), 'spool-lan')
  rmSync(dir, { recursive: true, force: true }) // leftovers from an earlier run
  lan = { gate: new Gate(loadCode({ reset: opts['new-code'] })), name: computerName(), dir }
}

const server = createServer({ root, tools, version, concurrency, allowOrigins: opts['allow-origin'], lan })

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  const running = await fetch(`${local}/api/health`).then((r) => r.json()).catch(() => null)
  if (running?.app === 'spool') {
    console.log(`\n  Spool is already running at ${local}\n`)
    if (!opts['no-open']) open(local)
    process.exit(0)
  }
  console.error(`\n  Port ${port} is taken. Try: npx spool --port ${port + 1}\n`)
  process.exit(1)
})

// LAN mode listens on every interface; without it only this computer can connect.
server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`\n  ${accent('●')} ${accent('spool')} ${version}\n`)
  console.log(`    open     ${local}`)
  console.log(`    saving   ${tilde(root)}`)
  printTools()
  if (lan) {
    startDiscovery({ port, name: lan.name, version })
    const ips = lanAddresses()
    console.log(`\n    phones   Wheelhouse › Spool › Find Spool on Wi-Fi`)
    console.log(`    code     ${accent(lan.gate.code.toString())}`)
    if (ips.length) console.log(dim(`    address  ${ips.map((ip) => `${ip}:${port}`).join('  ')}`))
    if (process.platform === 'darwin') console.log(dim('    if macOS asks, allow incoming connections for node'))
  }
  console.log(dim(`\n    also works from https://getspool.vercel.app · ctrl+c to stop\n`))
  if (!opts['no-open']) open(local)
})

function open(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
}

const stop = () => {
  for (const job of server.jobs.jobs.values()) server.jobs.cancel(job)
  server.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
