// The README's pictures, taken from the release build rather than drawn.
//
//   pnpm tauri build --no-bundle
//   node tools/shoot.mjs
//
// The build is started on a copy of `tools/demo-vault`, with `SCHEDA_HOME` and
// the webview's own profile in a directory of this run, so the scheda someone
// lives in on this machine is not read and not written: its settings, its
// session, its drafts and its index stay exactly where they are. The window is
// driven over the DevTools protocol WebView2 serves, and the run fails on any
// error or warning in the webview's console - a picture of a window that
// complained while it was taken is not a picture of the product.
//
// Windows only, for now: the pictures are taken on the machine the releases
// are checked on.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = join(root, 'src-tauri', 'target', 'release', 'scheda.exe')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

/** The size of the window in the pictures, in CSS pixels, and how dense. */
const VIEW = { width: 1200, height: 760, scale: 1.5 }
/** The note in front, and the one in the tab behind it. */
const FRONT = 'Garden plan.md'
const BEHIND = join('Plants', 'Tomatoes.md')

function fail(message) {
  console.error(`shoot: ${message}`)
  process.exit(1)
}

if (process.platform !== 'win32') fail('the pictures are taken on Windows')
if (!existsSync(exe)) fail(`no release build at ${exe} - run \`pnpm tauri build --no-bundle\` first`)
// The pictures belong to the version the README names.
const built = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.FileVersion`])
  .toString()
  .trim()
if (built !== version) fail(`the release build is ${built}, package.json says ${version} - build again`)
// A scheda already running would take the file into its own window: one
// instance per machine is what the program promises.
const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq scheda.exe', '/NH']).toString()
if (running.includes('scheda.exe')) fail('scheda is running - close it, and run this again')

const port = await new Promise((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

const run = mkdtempSync(join(tmpdir(), 'scheda-shoot-'))
const home = join(run, 'home')
const vault = join(run, 'vault')
mkdirSync(home)
cpSync(join(root, 'tools', 'demo-vault'), vault, { recursive: true })

const env = {
  ...process.env,
  SCHEDA_HOME: home,
  WEBVIEW2_USER_DATA_FOLDER: join(run, 'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
}
const launch = (file) => spawn(exe, [join(vault, file)], { env, stdio: 'ignore', detached: false })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const problems = []
let app = launch(BEHIND)

try {
  // ---------------------------------------------------------- connect --
  let target = null
  for (let attempt = 0; attempt < 60 && target === null; attempt++) {
    await sleep(500)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = pages.find((page) => page.type === 'page' && !page.url.includes('quick')) ?? null
    } catch {
      // Not listening yet.
    }
  }
  if (target === null) throw new Error(`the window never answered on port ${port}`)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let next = 0
  const pending = new Map()
  ws.addEventListener('message', (message) => {
    const data = JSON.parse(message.data)
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data)
      pending.delete(data.id)
    }
    if (data.method === 'Runtime.exceptionThrown') {
      problems.push(`exception: ${data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text}`)
    }
    if (data.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(data.params.type)) {
      problems.push(`console.${data.params.type}: ${data.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`)
    }
    if (data.method === 'Log.entryAdded' && ['error', 'warning'].includes(data.params.entry.level)) {
      problems.push(`${data.params.entry.source} ${data.params.entry.level}: ${data.params.entry.text}`)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++next
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (answer.result?.exceptionDetails) throw new Error(`${expression}: ${answer.result.exceptionDetails.text}`)
    return answer.result?.result?.value
  }
  const until = async (expression, what) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(expression)) return
      await sleep(250)
    }
    throw new Error(`${what} did not happen`)
  }
  const CTRL = 2
  const SHIFT = 8
  const press = async (key, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
    await sleep(300)
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width,
    height: VIEW.height,
    deviceScaleFactor: VIEW.scale,
    mobile: false,
  })

  // ------------------------------------------------------------ scene --
  await until(`!!document.querySelector('.cm-content')`, 'the first note')
  // The second launch hands its file to this window, as a double-click would.
  const second = launch(FRONT)
  await new Promise((resolve) => second.on('exit', resolve))
  await until(`document.querySelectorAll('.tab').length === 2`, 'the second tab')
  await until(`document.querySelector('.cm-content')?.textContent.includes('Four raised beds')`, 'the garden plan in front')

  await evaluate(`document.querySelector('.cm-content').focus()`)
  await press('E', 'KeyE', 69, CTRL | SHIFT)
  await until(`!!document.querySelector('.tree')`, 'the file tree')
  await press('O', 'KeyO', 79, CTRL | SHIFT)
  await until(`!!document.querySelector('.outline')`, 'the outline')
  // The caret at the end of the note and the view at its top: every line in
  // the picture is drawn, none of them is the one being edited.
  const settle = async () => {
    await evaluate(`document.querySelector('.cm-content').focus()`)
    await press('End', 'End', 35, CTRL)
    await evaluate(`document.querySelector('.cm-scroller').scrollTop = 0`)
    await sleep(600)
  }
  await settle()

  const shoot = async (theme, name) => {
    // The way a person switches it: the command palette, then the caret back
    // where it was.
    await press('P', 'KeyP', 80, CTRL | SHIFT)
    await until(`!!document.querySelector('.palette')`, 'the command palette')
    await send('Input.insertText', { text: `Theme: ${theme}` })
    await sleep(300)
    await press('Enter', 'Enter', 13)
    await until(`document.documentElement.dataset.theme === '${theme}'`, `the ${theme} theme`)
    await until(`!document.querySelector('.palette')`, 'the palette closing')
    await settle()
    const picture = await send('Page.captureScreenshot', { format: 'png' })
    const out = join(root, 'assets', name)
    writeFileSync(out, Buffer.from(picture.result.data, 'base64'))
    console.log(`shoot: ${name}, ${theme}`)
  }
  await shoot('light', 'screenshot.png')
  await shoot('dark', 'screenshot-dark.png')
  ws.close()
} catch (error) {
  problems.push(String(error?.message ?? error))
} finally {
  // The tree, not the process: the webview's own processes outlive a killed
  // scheda for a moment and hold its profile open.
  try {
    execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
  await new Promise((resolve) => (app.exitCode === null && app.signalCode === null ? app.on('exit', resolve) : resolve()))
  try {
    rmSync(run, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  } catch (error) {
    console.error(`shoot: left ${run} behind: ${error.message}`)
  }
}

if (problems.length > 0) fail(`the window was not clean while it was taken:\n  ${problems.join('\n  ')}`)
console.log(`shoot: scheda ${version}, pictures in assets/`)
