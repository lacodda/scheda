// Measures the built page in a real browser.
//
// The status bar going missing was not a bug any unit test could see: the
// markup was correct, React rendered it, and its host collapsed to zero height
// inside the flex column. Only a rendered box says so. This runs against
// `dist/`, so it checks what actually ships.
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const port = 4173

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ is missing — run `vite build` first')
  process.exit(1)
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const file = path.join(dist, rel)
  if (!fs.existsSync(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})
await new Promise((resolve) => server.listen(port, resolve))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })

// The page runs outside Tauri here, so `invoke` does not exist. Stub it with
// what the core would return for a bare launch: the shell has to come up on an
// empty buffer just as it does on a file.
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    invoke: async (command) => {
      if (command === 'plugin:event|listen') return 0
      return null
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (callback) => {
      const id = Math.floor(Math.random() * 1e9)
      window[`_${id}`] = callback
      return id
    },
  }
})

const failures = []
page.on('pageerror', (error) => failures.push(`uncaught: ${error.message}`))

await page.goto(`http://localhost:${port}/`)
await page.waitForSelector('.cm-editor', { timeout: 10_000 })
// The shell mounts after the first paint, on purpose.
await page.waitForSelector('.status', { timeout: 10_000 }).catch(() => {
  failures.push('the status bar never appeared')
})

const layout = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  }
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    scroller: box('.cm-scroller'),
    status: box('.status'),
    shellHost: box('.shell-host'),
  }
})

const check = (condition, message) => {
  if (!condition) failures.push(message)
}

check(layout.status !== null, 'the status bar is not in the document')
if (layout.status) {
  check(layout.status.h > 10, `the status bar has no height (${layout.status.h}px)`)
  check(
    Math.abs(layout.status.y + layout.status.h - layout.viewport.h) < 2,
    `the status bar is not at the bottom of the window (bottom ${
      layout.status.y + layout.status.h
    }, window ${layout.viewport.h})`,
  )
}
if (layout.scroller) {
  // The reading column is centred, not flush against an edge.
  const left = layout.scroller.x
  const right = layout.viewport.w - (layout.scroller.x + layout.scroller.w)
  check(
    Math.abs(left - right) < 4,
    `the reading column is off centre (${Math.round(left)}px left, ${Math.round(right)}px right)`,
  )
  check(
    layout.scroller.h > 100,
    `the editor has almost no height (${Math.round(layout.scroller.h)}px)`,
  )
}

await browser.close()
server.close()

if (failures.length > 0) {
  console.error('layout check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('layout check passed')
