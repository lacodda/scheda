// Readies the editor package for packing: its modules built, its licence beside
// them.
//
// Run by the package's `prepack`, so every way of packing it — `pnpm pack`, a
// publish from CI, the first publish by hand — goes through the same steps.
// The licence is the repository's; a copy kept in the package folder would be
// the one that falls behind, so it is copied in here and ignored by git.
import { execFileSync } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const editor = join(root, 'packages', 'editor')

// From nothing, so a module deleted from the source cannot ship from an old
// build.
rmSync(join(editor, 'dist'), { recursive: true, force: true })
execFileSync(process.execPath, [join(editor, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', join(editor, 'tsconfig.build.json')], {
  stdio: 'inherit',
})
copyFileSync(join(root, 'LICENSE'), join(editor, 'LICENSE'))
