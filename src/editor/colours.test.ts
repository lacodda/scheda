// The window gives the editor every colour it draws with.
//
// The editor package reads `--editor-<name>` and falls back to dowel's tokens
// for any it is not given. scheda has its own palette and no dowel theme, so a
// colour it forgot to map would not fail anything: it would fall back to a
// dowel variable this window never defines, and the thing it paints — a
// callout's rule, a search match — would quietly come out transparent. The
// mapping in `styles.css` is held against the package's own list instead.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editorTokens } from '@lacodda/scheda-editor'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(here, '../styles.css'), 'utf8')

/** The editor colours the stylesheet declares, by name. */
function declared(): string[] {
  return [...styles.matchAll(/^\s*--editor-([a-z0-9-]+):/gm)].map((match) => match[1])
}

describe('the editor colours', () => {
  it('maps every colour the editor reads', () => {
    const mapped = new Set(declared())
    const missing = editorTokens.filter((name) => !mapped.has(name))
    expect(missing).toEqual([])
  })

  it('maps nothing the editor does not read', () => {
    // A name left behind after the package dropped it reads as a colour that
    // still does something. The size is the one variable that is not a colour.
    const read = new Set<string>([...editorTokens, 'font-size'])
    expect(declared().filter((name) => !read.has(name))).toEqual([])
  })

  it('maps each colour onto one of the window’s own', () => {
    // Every value is a reference into the palette, so a theme switch reaches
    // the editor; a literal here would be a colour that stays put when the
    // window turns dark.
    for (const name of editorTokens) {
      const value = new RegExp(`--editor-${name}:\\s*([^;]+);`).exec(styles)?.[1].trim()
      expect(value, name).toMatch(/^var\(--[a-z0-9-]+\)$/)
      const own = value!.slice('var(--'.length, -1)
      expect(styles, `--${own} for --editor-${name}`).toMatch(new RegExp(`--${own}:`))
    }
  })
})
