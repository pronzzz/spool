import { randomInt, timingSafeEqual } from 'node:crypto'
import dgram from 'node:dgram'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// LAN mode lets a phone on the same Wi-Fi (Wheelhouse, the click-wheel music player) search
// and download through this engine. The phone pairs once with a short code printed in the
// terminal and may only use the /api/lan/ routes. Everything else stays localhost-only.

/** No 0/O or 1/I, so the code is easy to read and to spell with a click wheel. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6
export const DISCOVERY_MESSAGE = 'SPOOL-DISCOVER-1'

export function newCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'spool')
}

/** The pairing code is kept between runs so a paired phone keeps working. */
export function loadCode({ dir = configDir(), reset = false } = {}) {
  const file = path.join(dir, 'lan.json')
  if (!reset) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof saved.code === 'string' && saved.code.length === CODE_LENGTH) return saved.code
    } catch {
      // first run, or an unreadable file: make a new code
    }
  }
  const code = newCode()
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify({ code }, null, 2) + '\n', { mode: 0o600 })
  return code
}

/** IPv4 addresses other devices on the network can reach this computer at. */
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
}

export function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Checks the pairing code on every LAN request. Too many wrong codes from one address lock
 * that address out for a while, so the code can't be guessed by trying them all.
 */
export class Gate {
  constructor(code, { maxFailures = 8, windowMs = 10 * 60_000, lockMs = 10 * 60_000, now = Date.now } = {}) {
    this.code = Buffer.from(code.toUpperCase())
    this.maxFailures = maxFailures
    this.windowMs = windowMs
    this.lockMs = lockMs
    this.now = now
    this.failures = new Map() // ip -> { count, first, lockedUntil }
  }

  /** Returns 'ok', 'bad' or 'locked'. */
  check(ip, authorization) {
    const t = this.now()
    const f = this.failures.get(ip)
    if (f && f.lockedUntil > t) return 'locked'
    const given = Buffer.from(String(authorization || '').replace(/^Bearer\s+/i, '').trim().toUpperCase())
    if (given.length === this.code.length && timingSafeEqual(given, this.code)) {
      this.failures.delete(ip)
      return 'ok'
    }
    const entry = f && t - f.first < this.windowMs ? f : { count: 0, first: t, lockedUntil: 0 }
    entry.count++
    if (entry.count >= this.maxFailures) entry.lockedUntil = t + this.lockMs
    this.failures.set(ip, entry)
    return entry.lockedUntil > t ? 'locked' : 'bad'
  }
}

/** Answers "is there a Spool here?" broadcasts so phones can find this computer. */
export function startDiscovery({ port, name, version }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const reply = Buffer.from(JSON.stringify({ app: 'spool', name, port, version }))
  socket.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== DISCOVERY_MESSAGE) return
    socket.send(reply, rinfo.port, rinfo.address)
  })
  socket.on('error', () => socket.close())
  socket.bind(port)
  return socket
}

/** A friendly computer name ("Pranav's MacBook Air" rather than "pranavs-mbp.local"). */
export function computerName() {
  return (process.env.SPOOL_NAME || os.hostname().replace(/\.local$/, '')).slice(0, 60)
}
