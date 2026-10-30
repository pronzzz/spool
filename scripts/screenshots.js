// Captures README screenshots of the demo run, in dark and light.
// Usage: npm run build && npm run engine (another terminal) && npm run screenshots
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = process.env.SPOOL_URL ?? 'http://localhost:7317/'
await mkdir(`${root}docs`, { recursive: true })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage()
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1.5 })
  await page.goto(URL_, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.setItem('spool.format', JSON.stringify({ format: 'mp3', quality: '320' })))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.locator('::-p-text(Try the demo)').click()
  await page.locator('::-p-text(Spool 15)').click()
  await new Promise((r) => setTimeout(r, 5200))
  await page.evaluate(() => scrollTo(0, 0))
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: `${root}docs/hero-${theme}.jpg`, type: 'jpeg', quality: 84 })
  await page.evaluate(() => {
    const el = document.querySelector('.source')
    scrollTo(0, el.getBoundingClientRect().top + scrollY - 140)
  })
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: `${root}docs/run-${theme}.jpg`, type: 'jpeg', quality: 84 })
  console.log(`wrote docs/hero-${theme}.jpg, docs/run-${theme}.jpg`)
  await page.close()
}
await browser.close()
