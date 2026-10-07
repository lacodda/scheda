// The documentation page describes the package that is actually built.
//
// A program using the editor learns its surface and its colours from one page
// (`docs/src/content/docs/editor-package.md`). A colour added to the theme
// without a row there is a colour nobody knows to set, and an export without a
// mention is a thing nobody knows exists — so both lists are read from the
// code and looked for on the page.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as editor from './index.js'
import { fallbackOf, TOKENS } from './tokens.js'

const page = readFileSync(
  join(import.meta.dirname, '../../../docs/src/content/docs/editor-package.md'),
  'utf8',
)

describe('the editor package page', () => {
  it('has a row for every colour, with the token it falls back to', () => {
    const missing = TOKENS.filter((name) => {
      const row = page.split('\n').find((line) => line.startsWith(`| \`--editor-${name}\` |`))
      return row === undefined || !row.includes(`\`${fallbackOf(name)}\``)
    })
    expect(missing).toEqual([])
  })

  it('lists no colour the editor does not read', () => {
    const listed = [...page.matchAll(/^\| `--editor-([a-z0-9-]+)` \|/gm)].map((match) => match[1])
    expect(listed.filter((name) => !(TOKENS as string[]).includes(name))).toEqual([])
  })

  it('mentions everything the package exports', () => {
    // As code: a whole identifier inside a backtick span, so a word of prose
    // that happens to share a name does not count.
    const unmentioned = Object.keys(editor).filter(
      (name) => !new RegExp(`\`[^\`\\n]*\\b${name}\\b[^\`\\n]*\``).test(page),
    )
    expect(unmentioned).toEqual([])
  })
})
