// The line's list of commands, as copied from dowel's registry.
//
// `shortcut.tsx` and `commands.tsx` in this folder are dowel's, not scheda's:
// the notation, the reading of a keystroke and the list that answers it are
// the same in every program of the line, or the line has two notations again
// (ADR 0018). A copy that drifts is exactly that, one edit at a time - so this
// reads the registry inside the installed `dowel-ui` and fails when a copy is
// not the file it serves. Changing them is done in dowel, and arrives here by
// moving `dowel-ui` forward and copying again.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface Item {
  name: string
  files: { path: string; content: string }[]
}

const registry = JSON.parse(readFileSync(require.resolve('dowel-ui/registry.json'), 'utf8')) as { items: Item[] }

/** Line endings aside: a Windows checkout hands back CRLF for a file the
 *  registry serves with LF. */
const text = (source: string) => source.replace(/\r\n/g, '\n')

describe('the copies of dowel', () => {
  it.each(['shortcut', 'commands'])('%s is the file the registry serves', (name) => {
    const item = registry.items.find((candidate) => candidate.name === name)
    expect(item, `dowel-ui has no ${name} in its registry`).toBeDefined()
    const served = item!.files[0]!.content
    const copied = readFileSync(resolve(import.meta.dirname, `${name}.tsx`), 'utf8')
    expect(
      text(copied) === text(served),
      `src/ui/${name}.tsx is not dowel-ui's. Change it in dowel and copy it again ` +
        `from the registry of the dowel-ui this repository installs.`,
    ).toBe(true)
  })
})
