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
// A port already in use is the one failure here that lies. `listen` would fail,
// the promise would never settle or would settle anyway, and Playwright would
// load whatever the *other* process serves — so the gate reports "the editor
// never appeared" about a page it never fetched. A leftover server from an
// interrupted run is exactly how that happens.
await new Promise((resolve, reject) => {
  server.once('error', (error) => {
    reject(
      error.code === 'EADDRINUSE'
        ? new Error(`port ${port} is already in use — another run left a server behind`)
        : error,
    )
  })
  server.listen(port, resolve)
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })

// The page runs outside Tauri here, so `invoke` does not exist. Stub it with
// what the core would return for a bare launch: the shell has to come up on an
// empty buffer just as it does on a file.
// A document long enough to scroll. Without one there is no scrollbar to
// measure, and the gutter check passes on every stylesheet — including one that
// reserves a gutter.
const LONG_DOCUMENT = [
  // Block markup, at the top so it is inside the first viewport and therefore
  // actually decorated: CodeMirror only builds decorations for what is on
  // screen, and a check on markup scrolled out of view proves nothing.
  '```rust',
  'fn main() { let x = 1; }',
  '```',
  '',
  '- [ ] a task',
  '- [x] a finished task',
  '',
  '> [!warning] Careful',
  '> the body of the callout',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '---',
  '',
  'a ==marked== word',
  '',
  ...Array.from(
    { length: 400 },
    (_, index) => `Line ${index + 1} of a document that has to be taller than the window.`,
  ),
].join('\n')

await page.addInitScript((text) => {
  window.__TAURI_INTERNALS__ = {
    invoke: async (command) => {
      if (command === 'plugin:event|listen') return 0
      if (command === 'take_preloaded') {
        return {
          path: '/vault/notes/long.md',
          text,
          shape: { line_ending: 'lf', bom: false },
          readOnly: false,
        }
      }
      if (command === 'load_settings') {
        return { theme: 'system', font_size: 15, column_width: 46.0, recent: [], close_brackets: false }
      }
      // Drafts and file operations: the shell asks for these on mount and the
      // tree asks on every menu item. Answering with null would leave the
      // console full of rejected promises and the failure list full of noise
      // about the stub rather than the page.
      if (command === 'restore_drafts') return []
      if (command === 'keep_draft') return 'draft-1'
      if (command === 'discard_draft') return null
      // The network panel asks for these the moment it is opened. `null` would
      // reach the panel as a missing shape rather than an empty one, and the
      // failure would be about the stub rather than the page.
      if (command === 'read_network') return { backlinks: [], unresolved: [] }
      if (command === 'read_tree') {
        return {
          root: '/vault',
          name: 'vault',
          entries: [
            {
              name: 'notes',
              path: '/vault/notes',
              children: [{ name: 'long.md', path: '/vault/notes/long.md' }],
            },
            { name: 'top.md', path: '/vault/top.md' },
          ],
        }
      }
      return null
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (callback) => {
      const id = Math.floor(Math.random() * 1e9)
      window[`_${id}`] = callback
      return id
    },
  }
}, LONG_DOCUMENT)

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

  const scroller = document.querySelector('.cm-scroller')

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    titlebar: box('.titlebar'),
    tabs: box('.tabs'),
    windowButtons: box('.window-buttons'),
    scroller: box('.cm-scroller'),
    status: box('.status'),
    shellHost: box('.shell-host'),
    scrollable: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
  }
})

// The grammar for a fenced block is fetched on demand, so the colouring lands a
// moment after the text does. Waiting for it is not optional politeness: read
// the DOM too early and the check fails on a perfectly good build, which is
// exactly what this gate did on three runs out of five before the wait was
// added. The failure below stays honest — if the spans never arrive, the check
// still reports it.
await page
  .waitForFunction(
    () => {
      const line = document.querySelector('.cm-md-code-line + .cm-md-code-line')
      return line ? line.querySelectorAll('span[class]').length >= 6 : false
    },
    { timeout: 10_000 },
  )
  .catch(() => {})

// Block markup, measured in a real browser for the same reason the layout is:
// jsdom applies no styles and finishes no nested parse, so the unit tests can
// see that a class was applied but not that anything is drawn.
const markup = await page.evaluate(() => {
  const count = (selector) => document.querySelectorAll(selector).length
  const codeLine = document.querySelector('.cm-md-code-line + .cm-md-code-line')
  const measure = (selector, properties) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const style = getComputedStyle(element)
    return Object.fromEntries(properties.map((name) => [name, style[name]]))
  }
  return {
    listLines: count('.cm-md-list-line'),
    tasks: count('input.cm-md-task'),
    tasksChecked: count('input.cm-md-task:checked'),
    calloutWarning: count('.cm-md-callout-warning'),
    calloutHeads: count('.cm-md-callout-head'),
    tableLines: count('.cm-md-table-line'),
    codeLines: count('.cm-md-code-line'),
    // The dashes are drawn as the line they stand for, so the class to look
    // for is the drawn rule rather than the dimmed characters.
    rules: count('.cm-md-drawn-rule'),
    highlights: count('.cm-md-highlight'),
    // The tokens inside the fence. CodeMirror generates its own class names
    // rather than anything readable, so the check counts coloured spans instead
    // of naming them.
    codeSpans: codeLine ? codeLine.querySelectorAll('span[class]').length : 0,
    listIndent: measure('.cm-md-list-line', ['paddingLeft', 'textIndent']),
    calloutRule: measure('.cm-md-callout-warning', ['borderLeftWidth', 'borderLeftColor']),
  }
})

const check = (condition, message) => {
  if (!condition) failures.push(message)
}

// The window draws its own frame, so the title bar is the top edge: the tabs
// and the window buttons live in it, and the editor starts directly under it.
check(layout.titlebar !== null, 'the title bar is missing, and with it the window controls')
if (layout.titlebar) {
  check(
    Math.abs(layout.titlebar.y) < 2,
    `the title bar is not at the top of the window (y ${Math.round(layout.titlebar.y)})`,
  )
  check(
    layout.tabs !== null && layout.tabs.y >= layout.titlebar.y - 1,
    'the tabs are not inside the title bar, which is the band they were moved into',
  )
  check(
    layout.windowButtons !== null,
    'the window buttons are missing, and a frameless window has no others',
  )
  if (layout.windowButtons) {
    check(
      Math.abs(layout.windowButtons.x + layout.windowButtons.w - layout.viewport.w) < 2,
      'the window buttons are not at the right edge, where every Windows application puts them',
    )
  }
  // The point of the whole exercise: one band at the top, not two.
  check(
    layout.titlebar.h < 48,
    `the title bar is ${Math.round(layout.titlebar.h)}px tall, which is a band and a half`,
  )
  if (layout.scroller) {
    check(
      Math.abs(layout.scroller.y - layout.titlebar.h) < 2,
      `the editor does not start directly under the title bar (editor at ${Math.round(
        layout.scroller.y,
      )}, bar ends at ${Math.round(layout.titlebar.h)})`,
    )
  }
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
  // The scroller spans the window, so its scrollbar sits at the window's edge
  // rather than floating in the middle beside a narrowed column.
  check(
    Math.abs(layout.scroller.w - layout.viewport.w) < 2,
    `the scroller does not span the window (${Math.round(layout.scroller.w)} of ${
      layout.viewport.w
    }px), which puts its scrollbar somewhere in the middle`,
  )
  check(
    layout.scroller.h > 100,
    `the editor has almost no height (${Math.round(layout.scroller.h)}px)`,
  )
  // Whether the scrollbar reserves layout space is deliberately NOT checked
  // here. Headless Chromium overlays its scrollbars whatever the stylesheet
  // says, so `offsetWidth - clientWidth` reads zero for a classic bar too — the
  // check would pass on a stylesheet that reserves a gutter, which is worse
  // than no check. That property is verified by eye in the real WebView.
  check(
    layout.scrollable,
    'the test document does not scroll, so nothing here exercises the scroller',
  )
}

// ------------------------------------------------------------- markup --

check(markup.listLines === 2, `list lines: ${markup.listLines}, expected 2`)
check(markup.tasks === 2, `checkboxes drawn: ${markup.tasks}, expected 2`)
check(
  markup.tasksChecked === 1,
  `checked boxes: ${markup.tasksChecked}, expected 1 - a done task must look done`,
)
check(
  markup.calloutWarning === 2,
  `callout lines in the warning colour: ${markup.calloutWarning}, expected 2`,
)
check(markup.calloutHeads === 1, `callout heads: ${markup.calloutHeads}, expected 1`)
check(markup.tableLines === 3, `table lines: ${markup.tableLines}, expected 3`)
check(markup.codeLines === 3, `code lines: ${markup.codeLines}, expected 3`)
// One for the horizontal rule, plus one per column of the table's delimiter
// row — the document in this gate has a two-column table.
check(markup.rules === 3, `drawn rules: ${markup.rules}, expected 3`)
check(markup.highlights === 1, `highlighted runs: ${markup.highlights}, expected 1`)

// The point of carrying grammars at all. Six is a floor, not an exact count: a
// grammar update may split the tokens differently, but zero means the
// highlighting is gone - which is how it shipped missing the first time.
check(
  markup.codeSpans >= 6,
  `coloured spans inside the fence: ${markup.codeSpans}, expected at least 6 -` +
    ' the grammar or the highlight style is missing',
)

// A wrapped list item hangs under its own text. Both halves matter: the padding
// puts the item in, the negative indent pulls its first line back out to the
// bullet. Either one alone looks wrong, in a different way each time.
if (markup.listIndent) {
  check(
    parseFloat(markup.listIndent.paddingLeft) > 0,
    `list items are not indented (padding ${markup.listIndent.paddingLeft})`,
  )
  check(
    parseFloat(markup.listIndent.textIndent) < 0,
    `list items have no hanging indent (text-indent ${markup.listIndent.textIndent}),` +
      ' so a wrapped line slides back under the bullet',
  )
} else {
  failures.push('no list line to measure')
}

// The callout's rule is what carries its colour.
if (markup.calloutRule) {
  check(
    parseFloat(markup.calloutRule.borderLeftWidth) >= 2,
    `the callout rule is ${markup.calloutRule.borderLeftWidth}, which is not a rule`,
  )
} else {
  failures.push('no callout line to measure')
}

// Reading mode, driven by the real keyboard in a real browser. The unit tests
// dispatch the effect directly; this is the only place the binding itself is
// exercised, and a binding that never fires is a feature nobody can reach.
await page.click('.cm-content')
const readingBefore = await page.evaluate(() => document.querySelectorAll('.cm-reading').length)
await page.keyboard.press('Control+e')
await page.waitForTimeout(300)
const reading = await page.evaluate(() => {
  const editor = document.querySelector('.cm-editor')
  return {
    on: editor ? editor.classList.contains('cm-reading') : false,
    caretVisible: (() => {
      const caret = document.querySelector('.cm-cursor')
      if (!caret) return false
      return getComputedStyle(caret).display !== 'none'
    })(),
  }
})
await page.keyboard.press('Control+e')
await page.waitForTimeout(300)
const readingOff = await page.evaluate(() =>
  document.querySelector('.cm-editor')?.classList.contains('cm-reading') ?? false,
)

check(readingBefore === 0, 'reading mode is on before anything asked for it')
check(reading.on, 'Ctrl+E did not turn reading mode on')
check(!reading.caretVisible, 'the caret is still drawn in reading mode')
check(!readingOff, 'Ctrl+E did not turn reading mode off again')

// The outline panel, driven by its real key in a real browser. It changes the
// layout — the editor gives up width to it — so this is the place to check it:
// a unit test can see the component render and not that the text still fits
// beside it.
await page.click('.cm-content')
const outlineClosed = await page.evaluate(() => document.querySelectorAll('.outline').length)
await page.keyboard.press('Control+Shift+o')
await page.waitForTimeout(300)
const outline = await page.evaluate(() => {
  const panel = document.querySelector('.outline')
  const editor = document.querySelector('.editor-host')
  const items = [...document.querySelectorAll('.outline-item')].map((e) => e.textContent)
  return {
    open: panel !== null,
    items,
    panelWidth: panel ? panel.getBoundingClientRect().width : 0,
    panelHeight: panel ? panel.getBoundingClientRect().height : 0,
    editorHeight: editor ? editor.getBoundingClientRect().height : 0,
    editorWidth: editor ? editor.getBoundingClientRect().width : 0,
    // Nothing may hang off the right edge: a panel that pushes the editor out
    // of the window is worse than no panel.
    overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
  }
})
await page.keyboard.press('Control+Shift+o')
await page.waitForTimeout(300)
const outlineAgain = await page.evaluate(() => document.querySelectorAll('.outline').length)

check(outlineClosed === 0, 'the outline is open before anything asked for it')
check(outline.open, 'Ctrl+Shift+O did not open the outline')
check(outline.panelWidth > 80, `the outline is ${Math.round(outline.panelWidth)}px wide, which is not a panel`)
check(outline.editorWidth > 200, `the editor is left ${Math.round(outline.editorWidth)}px, which is not a column`)
check(!outline.overflows, 'the outline pushes the window into horizontal scrolling')
// Full height, not just as tall as its list. The React root it renders into is
// a plain block by default, so the panel ended partway down the window with the
// editor's background showing beneath it — visible in a screenshot, invisible
// to every assertion about its contents.
check(
  Math.abs(outline.panelHeight - outline.editorHeight) < 2,
  `the outline is ${Math.round(outline.panelHeight)}px tall beside a ${Math.round(
    outline.editorHeight,
  )}px editor, so it stops partway down the window`,
)
check(outlineAgain === 0, 'Ctrl+Shift+O did not close the outline again')

// The file tree, on its own key, in a real browser. Like the outline it takes
// width from the editor, so the layout is what this checks — and, once open,
// that the branch holding the open document opened with it.
await page.click('.cm-content')
const treeClosed = await page.evaluate(() => document.querySelectorAll('.tree').length)
await page.keyboard.press('Control+Shift+e')
await page.waitForTimeout(400)
const tree = await page.evaluate(() => {
  const panel = document.querySelector('.tree')
  const editor = document.querySelector('.editor-host')
  return {
    open: panel !== null,
    width: panel ? panel.getBoundingClientRect().width : 0,
    height: panel ? panel.getBoundingClientRect().height : 0,
    editorHeight: editor ? editor.getBoundingClientRect().height : 0,
    editorWidth: editor ? editor.getBoundingClientRect().width : 0,
    rows: [...document.querySelectorAll('.tree-item')].map((e) => e.textContent),
    current: document.querySelectorAll('.tree-current').length,
    overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
  }
})
// The context menu and the row you type a name into, in a real browser.
//
// Both are drawn over the tree — one fixed to the pointer, one in the flow of
// the list — and both are the kind of thing a unit test renders correctly while
// the real page puts it behind the editor or off the bottom of the window. The
// menu is opened on a *file* on purpose: a right click there means "beside this
// one", and it is the case where the obvious implementation asks the core to
// create a file inside a file.
await page.click('.tree-file')
await page.waitForTimeout(200)
await page.click('.tree-file', { button: 'right' })
await page.waitForTimeout(200)
const menu = await page.evaluate(() => {
  const panel = document.querySelector('.tree-menu')
  if (!panel) return { open: false }
  const rect = panel.getBoundingClientRect()
  const items = [...panel.querySelectorAll('button')].map((b) => b.textContent)
  const sample = panel.querySelector('button')
  return {
    open: true,
    items,
    // Inside the window on both axes: a menu opened near the bottom edge that
    // runs off it is a menu whose last item cannot be clicked.
    insideWindow:
      rect.right <= window.innerWidth + 1 &&
      rect.bottom <= window.innerHeight + 1 &&
      rect.left >= -1 &&
      rect.top >= -1,
    // Over the tree, not under it: the panel and the editor both paint after
    // it in document order.
    onTop: (() => {
      const at = document.elementFromPoint(rect.left + 8, rect.top + rect.height - 8)
      return at !== null && panel.contains(at)
    })(),
    background: sample ? getComputedStyle(panel).backgroundColor : null,
  }
})

// Naming: the row appears in the list, at the depth the file will have, with a
// field that already has focus — otherwise the first keystroke goes to the
// editor behind it.
await page.screenshot({ path: 'tools/tree-menu.png' })

const naming = await (async () => {
  if (!menu.open) return { shown: false }
  await page.click('.tree-menu button:nth-of-type(1)')
  await page.waitForTimeout(200)
  return page.evaluate(() => {
    const row = document.querySelector('.tree-naming')
    const field = document.querySelector('.tree-name-input')
    const tree = document.querySelector('.tree')
    if (!row || !field || !tree) return { shown: false }
    const rowRect = row.getBoundingClientRect()
    const treeRect = tree.getBoundingClientRect()
    return {
      shown: true,
      focused: document.activeElement === field,
      // Inside the panel, not spilling past its right edge into the editor.
      insidePanel: rowRect.right <= treeRect.right + 1 && rowRect.left >= treeRect.left - 1,
      width: field.getBoundingClientRect().width,
      menuGone: document.querySelectorAll('.tree-menu').length === 0,
    }
  })
})()

await page.screenshot({ path: 'tools/tree-naming.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

check(menu.open, 'a right click on a file opened no menu')
if (menu.open) {
  check(
    menu.items.length === 4,
    `the menu offers ${menu.items.length} items, expected four (two to make, rename, delete)`,
  )
  check(
    menu.items.some((item) => item.toLowerCase().includes('recycle bin')),
    `the menu does not say where a deleted file goes — items were ${JSON.stringify(menu.items)}`,
  )
  check(menu.insideWindow, 'the menu runs off the edge of the window')
  check(menu.onTop, 'the menu is drawn under the tree rather than over it')
  check(
    menu.background !== 'rgba(0, 0, 0, 0)',
    'the menu has no background, so the tree reads through it',
  )
}
check(naming.shown, 'choosing "New note" did not offer a row to type a name in')
if (naming.shown) {
  check(naming.menuGone, 'the menu stayed open after an item was chosen')
  check(naming.focused, 'the name field does not have focus, so the first keystroke is lost')
  check(naming.insidePanel, 'the name field spills out of the tree panel')
  check(naming.width > 60, `the name field is ${Math.round(naming.width)}px wide, which is a slot`)
}

await page.keyboard.press('Control+Shift+e')
await page.waitForTimeout(300)
const treeAgain = await page.evaluate(() => document.querySelectorAll('.tree').length)

check(treeClosed === 0, 'the file tree is open before anything asked for it')
check(tree.open, 'Ctrl+Shift+E did not open the file tree')
check(tree.width > 80, `the tree is ${Math.round(tree.width)}px wide, which is not a panel`)
check(
  Math.abs(tree.height - tree.editorHeight) < 2,
  `the tree is ${Math.round(tree.height)}px tall beside a ${Math.round(
    tree.editorHeight,
  )}px editor, so it stops partway down the window`,
)
check(tree.editorWidth > 200, `the editor is left ${Math.round(tree.editorWidth)}px, which is not a column`)
check(!tree.overflows, 'the tree pushes the window into horizontal scrolling')
// The branch holding the open document opens with the tree: without it the
// highlight marking the current file is never on screen, which makes it not a
// highlight at all.
check(
  tree.rows.some((row) => row.includes('long.md')),
  `the branch holding the open file did not open — rows were ${JSON.stringify(tree.rows)}`,
)
check(tree.current === 1, `the open file is marked ${tree.current} times, expected once`)
check(treeAgain === 0, 'Ctrl+Shift+E did not close the file tree again')

await browser.close()
server.close()

if (failures.length > 0) {
  console.error('layout check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('layout check passed')
if (process.env.LAYOUT_VERBOSE) {
  console.log(JSON.stringify(layout, null, 2))
}
