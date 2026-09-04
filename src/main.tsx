// Order of operations, which is the whole promise of the product.
//
// The file is already in the core's hands before this module runs (the core
// read it before the window existed). So the first thing that happens here is
// asking for it and putting it into an editor — no framework, no router, no
// theme provider in front of that. React mounts the shell *after* the first
// character is on screen, because nothing in the shell is worth a frame of the
// text.
import { reportFirstPaint, takePreloaded, type OpenFile } from './core'
import { mountEditor } from './editor/mount'
import './styles.css'

const root = document.getElementById('root')!

// A released build has no console. An error in the shell would otherwise show
// up only as something quietly missing from the window — which is exactly how
// the recent list went unnoticed — so failures are reported on screen and, when
// the startup log is on, to its file.
window.addEventListener('error', (event) => {
  reportFailure('something went wrong', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  reportFailure('something went wrong', event.reason)
})

async function start() {
  let file: OpenFile | null = null
  try {
    file = await takePreloaded()
  } catch {
    // A missing core is not a reason to show nothing; an empty editor is still
    // an editor.
  }

  const editor = mountEditor(root, file)

  // requestAnimationFrame fires before the paint; the timing we want is after
  // it, which is the frame following.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void reportFirstPaint()
    })
  })

  // Everything that is not the text waits until the text is there. A failure
  // here must not be silent: the editor would keep working and the status bar
  // would simply never appear, which is indistinguishable from not having
  // written one.
  try {
    const { mountShell } = await import('./shell')
    mountShell(editor)
  } catch (error) {
    reportFailure('the status bar failed to load', error)
  }
}

/** Shows a failure in the window itself. There is no console to read in a
 *  released build, and a silent failure in the shell is invisible. */
function reportFailure(what: string, error: unknown) {
  const banner = document.createElement('div')
  banner.className = 'failure'
  banner.textContent = `${what}: ${error instanceof Error ? error.message : String(error)}`
  root.appendChild(banner)
}

void start()
