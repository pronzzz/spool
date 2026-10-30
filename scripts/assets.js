// Renders the PNG icons and the social card with system Chrome.
// Usage: npm run assets   (set CHROME_PATH if Chrome lives elsewhere)
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = `${root}web/public/`
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const font = async (path) => `data:font/woff2;base64,${(await readFile(`${root}node_modules/${path}`)).toString('base64')}`
const serif = await font('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2')
const serifItalic = await font('@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2')
const sans = await font('@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2')
const mono = await font('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')

const C = { bg: '#0f0f0d', raised: '#161614', sunk: '#0a0a09', line: '#262521', strong: '#3a3833', text: '#ece8e0', muted: '#9a958b', accent: '#ff5a1f', pack: '#2c2a26' }

const fonts = `
@font-face{font-family:S;font-style:normal;src:url(${serif})}
@font-face{font-family:S;font-style:italic;src:url(${serifItalic})}
@font-face{font-family:G;src:url(${sans})}
@font-face{font-family:M;src:url(${mono})}`

// Same geometry as web/src/components/Deck.tsx, frozen at 60% through a run.
function deck(share) {
  const HUB = 20, MAX = 66
  const r = (s) => Math.sqrt(HUB * HUB + (MAX * MAX - HUB * HUB) * s)
  const L = { x: 128, y: 118 }, R = { x: 312, y: 118 }, PL = { x: 66, y: 212 }, PR = { x: 374, y: 212 }
  const tan = (c, rad, p, side) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y)
    const t = Math.atan2(p.y - c.y, p.x - c.x) + side * Math.acos(rad / d)
    return { x: c.x + rad * Math.cos(t), y: c.y + rad * Math.sin(t) }
  }
  const rl = r(1 - share), rr = r(share)
  const a = tan(L, rl, PL, 1), b = tan(R, rr, PR, -1)
  const hub = (c, rot) => `<g transform="rotate(${rot} ${c.x} ${c.y})"><circle cx="${c.x}" cy="${c.y}" r="${HUB}" fill="${C.raised}" stroke="${C.text}" stroke-width="1.5"/>${[0, 120, 240]
    .map((d) => `<rect x="${c.x - 2.5}" y="${c.y - HUB + 3}" width="5" height="7" rx="1.5" fill="${C.text}" transform="rotate(${d} ${c.x} ${c.y})"/>`)
    .join('')}<circle cx="${c.x}" cy="${c.y}" r="4" fill="${C.sunk}" stroke="${C.text}"/></g>`
  return `<svg viewBox="0 0 440 268" width="460">
<rect x="8" y="8" width="424" height="252" rx="18" fill="${C.raised}" stroke="${C.strong}" stroke-width="1.25"/>
<rect x="88" y="56" width="264" height="124" rx="62" fill="${C.sunk}" stroke="${C.line}"/>
<circle cx="36" cy="36" r="5" fill="${C.accent}"/><text x="48" y="40" font-family="M" font-size="10.5" letter-spacing="1.5" fill="${C.muted}">REC</text>
<text x="404" y="40" text-anchor="end" font-family="M" font-size="10.5" letter-spacing="1.5" fill="${C.muted}">SIDE A — YOUR PLAYLIST</text>
<circle cx="${L.x}" cy="${L.y}" r="${rl}" fill="${C.pack}" stroke="${C.strong}"/>
<circle cx="${R.x}" cy="${R.y}" r="${rr}" fill="${C.pack}" stroke="${C.strong}"/>
<path d="M${a.x} ${a.y} L${PL.x} ${PL.y} L${PR.x} ${PR.y} L${b.x} ${b.y}" fill="none" stroke="${C.text}" stroke-width="1.5"/>
${hub(L, 20)}${hub(R, 70)}
<circle cx="${PL.x}" cy="${PL.y}" r="5" fill="${C.raised}" stroke="${C.text}" stroke-width="1.5"/>
<circle cx="${PR.x}" cy="${PR.y}" r="5" fill="${C.raised}" stroke="${C.text}" stroke-width="1.5"/>
<rect x="196" y="206" width="48" height="14" rx="3" fill="${C.text}"/></svg>`
}

const og = `<!doctype html><style>${fonts}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:${C.bg};color:${C.text};font-family:G;display:grid;grid-template-columns:1fr 470px;gap:48px;padding:72px 80px;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font:500 34px G;letter-spacing:-.03em;margin-bottom:54px}
.eyebrow{font:500 15px M;letter-spacing:.2em;text-transform:uppercase;color:${C.muted}}
h1{font:400 98px/.92 S;letter-spacing:-.03em;margin-top:22px}
h1 em{color:${C.accent}}
.count{font:400 40px M;text-align:center;margin-top:20px}.count i{font:italic 40px S;color:#67635c;margin:0 12px}
</style><body><div>
<div class="brand"><svg width="38" height="38" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="${C.text}" stroke-width="2"/><circle cx="16" cy="16" r="8.5" fill="${C.text}" opacity=".18"/><circle cx="16" cy="16" r="3" fill="${C.text}"/><circle cx="26.5" cy="26.5" r="3.4" fill="${C.accent}"/></svg>spool</div>
<p class="eyebrow">A calm front end for yt-dlp</p>
<h1>Wind a whole <em>playlist</em> onto your disk.</h1></div>
<div>${deck(0.6)}<p class="count">109<i>/</i>182</p></div></body>`

const icon = (size, pad) => `<!doctype html><style>*{margin:0}body{width:${size}px;height:${size}px;background:${C.bg};display:grid;place-items:center}</style><body>
<svg width="${size - pad * 2}" height="${size - pad * 2}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="${C.text}" stroke-width="2"/><circle cx="16" cy="16" r="8" fill="${C.text}" opacity=".2"/><circle cx="16" cy="16" r="3" fill="${C.text}"/><circle cx="25.6" cy="25.6" r="3.6" fill="${C.accent}"/></svg></body>`

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
async function shot(html, width, height, file) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${out}${file}`, type: 'png' })
  console.log(`wrote web/public/${file}`)
}
await shot(og, 1200, 630, 'og.png')
await shot(icon(512, 72), 512, 512, 'icon-512.png')
await shot(icon(192, 26), 192, 192, 'icon-192.png')
await shot(icon(180, 24), 180, 180, 'apple-touch-icon.png')
await browser.close()
