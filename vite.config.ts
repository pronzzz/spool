import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  root: 'web',
  // Written against React's API; Preact runs it at a fraction of the size.
  plugins: [preact()],
  define: { __VERSION__: JSON.stringify(version) },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5317,
    proxy: { '/api': 'http://127.0.0.1:7317' },
  },
})
