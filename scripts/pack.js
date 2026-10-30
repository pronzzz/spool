// Packs the engine + built web app into dist/spool-<version>.tgz, so the
// hosted site serves the exact file `npx` installs.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(tmpdir(), 'spool-pack-'))
const out = execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], { encoding: 'utf8', shell: process.platform === 'win32' })
const [{ filename, size, entryCount }] = JSON.parse(out)
copyFileSync(path.join(tmp, filename), path.join("dist", filename)) // copy: tmp may be another disk
rmSync(tmp, { recursive: true, force: true })
console.log(`packed dist/${filename} (${entryCount} files, ${(size / 1024).toFixed(0)} kB)`)
