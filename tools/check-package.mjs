// Packs the editor package and opens it the way a program that installs it will.
//
// Built, typechecked and packed is not the same as importable. A package of
// this line once went to the registry with an entry module Node could not load:
// its imports had no file extensions, which every bundler forgives and Node
// does not, and every check before the publish ran inside a bundler. So this
// packs the real tarball, unpacks it, and imports it by name in a separate Node
// process — the one runtime that forgives nothing.
//
// It also holds the package's surface: the names it exports are listed below,
// and adding or dropping one is a change to what every program using the
// editor may rely on, so it is made here on purpose rather than by accident.
//
// The package reaches no registry: it is attached to each release, and a
// program installs it from there by URL (ADR 0015). `--out <dir>` keeps the
// tarball this check passed, so what the release carries is what was checked.
import { execSync, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const editor = join(root, 'packages', 'editor')
const outAt = process.argv.indexOf('--out')
const out = outAt === -1 ? null : process.argv[outAt + 1]

/** What the package exports, in alphabetical order. */
const SURFACE = [
  'WORDS_PER_MINUTE',
  'blocks',
  'bodyWords',
  'countWords',
  'documentPath',
  'drawDiagram',
  'editorTokens',
  'forgetDocument',
  'forgetNotes',
  'isFocusing',
  'moveSection',
  'outlineOf',
  'readingMinutes',
  'readingMode',
  'relativeFrom',
  'renderPage',
  'resourcesOf',
  'schedaEditor',
  'setBracketClosing',
  'setDocumentPath',
  'setFocusing',
  'setSpelling',
  'toggleFocus',
  'toggleReading',
]

/** The files a program needs from the tarball. */
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']

/** What has no business in the tarball: sources, tests, configuration. */
const FORBIDDEN = [/^src\//, /\.test\./, /^test\//, /tsconfig/, /vitest\.config/]

/** Reads a tar archive into a list of files. Twenty lines rather than a
 *  dependency: a tarball from `pnpm pack` is plain ustar. */
function untar(archive) {
  const files = []
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    const field = (from, to) => header.subarray(from, to).toString('utf8').replace(/\0.*$/s, '')
    const name = field(0, 100)
    if (name === '') break
    const size = parseInt(field(124, 136).trim() || '0', 8)
    const type = field(156, 157)
    const prefix = field(345, 500)
    const path = prefix === '' ? name : `${prefix}/${name}`
    const data = archive.subarray(offset + 512, offset + 512 + size)
    if (type === '0' || type === '') files.push({ path, data })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const failures = []
const temp = mkdtempSync(join(tmpdir(), 'scheda-editor-'))
const unpacked = join(temp, 'package')
const linked = join(unpacked, 'node_modules')

try {
  // `pnpm pack` runs the package's own `prepack`, which builds it — the same
  // path a publish takes.
  execSync(`pnpm pack --pack-destination "${temp}"`, { cwd: editor, stdio: 'inherit' })
  const tarball = readdirSync(temp).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('pnpm pack left no tarball')

  const files = untar(gunzipSync(readFileSync(join(temp, tarball))))
  const paths = files.map((file) => file.path.replace(/^package\//, ''))
  for (const path of REQUIRED) {
    if (!paths.includes(path)) failures.push(`the tarball has no ${path}`)
  }
  for (const path of paths) {
    if (FORBIDDEN.some((pattern) => pattern.test(path))) failures.push(`the tarball carries ${path}`)
  }

  for (const file of files) {
    const target = join(temp, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.data)
  }
  // The dependencies are the workspace's, linked rather than installed: the
  // check needs no network, and it loads the same CodeMirror the tests do.
  symlinkSync(join(editor, 'node_modules'), linked, 'junction')

  // By name, from inside the unpacked package: Node resolves a package's own
  // name through its `exports`, without the source condition this repository
  // uses — exactly as a program that installed it would.
  const script = `
    const editor = await import('@lacodda/scheda-editor')
    const { EditorState } = await import('@codemirror/state')
    // A state built with the package's facets and fields: a second copy of
    // CodeMirror behind the package would throw right here.
    const state = EditorState.create({
      doc: '# Title\\n\\nSee [[plan]] and ![a](b.png).',
      extensions: editor.schedaEditor({
        host: {
          assets: { resolve: async () => null },
          notes: {
            resolve: async () => [],
            create: async () => '',
            suggest: async () => [],
            headings: async () => [],
            peek: async () => null,
          },
        },
      }),
    })
    const headings = editor.outlineOf(state).map((heading) => heading.text)
    if (headings.join() !== 'Title') throw new Error('outline read ' + JSON.stringify(headings))
    console.log(JSON.stringify(Object.keys(editor).sort()))
  `
  const exported = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: unpacked, encoding: 'utf8' }),
  )
  const missing = SURFACE.filter((name) => !exported.includes(name))
  const extra = exported.filter((name) => !SURFACE.includes(name))
  if (missing.length > 0) failures.push(`the package no longer exports ${missing.join(', ')}`)
  if (extra.length > 0) failures.push(`the package now also exports ${extra.join(', ')} — list it here if it is meant to`)

  if (out !== null && failures.length === 0) {
    mkdirSync(out, { recursive: true })
    copyFileSync(join(temp, tarball), join(out, tarball))
    console.log(`kept ${join(out, tarball)}`)
  }
} finally {
  // The link first, on its own: removing the folder must not walk into the
  // workspace's node_modules through it.
  try {
    unlinkSync(linked)
  } catch {
    // Never made: the check stopped before it.
  }
  rmSync(temp, { recursive: true, force: true })
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check:package — ${failure}`)
  process.exit(1)
}
console.log('package check passed')
