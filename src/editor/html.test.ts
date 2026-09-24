// The page a note prints as and exports to.
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { renderPage, resourcesOf, type Resources } from './html'
import { schedaSetup } from './setup'

const none: Resources = { images: new Map(), diagrams: new Map() }

function page(doc: string, resources = none): string {
  const state = EditorState.create({ doc, extensions: schedaSetup() })
  const html = renderPage(state, 'Note', resources)
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim()
}

describe('the page', () => {
  it('drops the markers and the front matter', () => {
    expect(page('---\ntitle: x\n---\n# Title\n\nSome **bold**, *soft*, ~~gone~~ and ==lit== `code`.\n')).toBe(
      '<h1>Title</h1>\n<p>Some <strong>bold</strong>, <em>soft</em>, <del>gone</del> and <mark>lit</mark> <code>code</code>.</p>',
    )
  })

  it('escapes whatever HTML the note holds', () => {
    const html = page('<script>alert(1)</script>\n\nText with <b>tags</b> & "quotes".\n')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; &quot;quotes&quot;')
  })

  it('links only what a page can follow safely', () => {
    expect(page('[site](https://example.com) and [bad](javascript:alert(1)) and [note](other.md)\n')).toBe(
      '<p><a href="https://example.com">site</a> and bad and note</p>',
    )
  })

  it('keeps a pipe inside code in its cell, and the column alignment', () => {
    expect(page('| cmd | n |\n| --- | ---: |\n| `a \\| b` | 1 |\n')).toContain(
      '<tr><td><code>a | b</code></td><td style="text-align:right">1</td></tr>',
    )
  })

  it('draws tasks, numbering and callouts', () => {
    expect(page('- [x] done\n- [ ] open\n')).toContain('<input type="checkbox" disabled checked> done')
    expect(page('3. three\n4. four\n')).toMatch(/^<ol start="3">/)
    const callout = page('> [!warning] Mind the gap\n> Careful.\n')
    expect(callout).toContain('<div class="callout callout-warning"><p class="callout-title">Mind the gap</p>')
    expect(callout).toContain('<p>Careful.</p>')
  })

  it('shows a wikilink as its alias or its target', () => {
    expect(page('[[Note#Part|shown]] and [[Other#Part]]\n')).toBe(
      '<p><span class="wikilink">shown</span> and <span class="wikilink">Other › Part</span></p>',
    )
  })

  it('puts pictures and diagrams in from the resources, and their text without them', () => {
    const doc = '![a dot](dot.png)\n\n![[shot.png]]\n\n```mermaid\ngraph TD; A-->B\n```\n'
    const state = EditorState.create({ doc, extensions: schedaSetup() })
    expect(resourcesOf(state)).toEqual({
      images: ['dot.png'],
      wikiImages: ['shot.png'],
      diagrams: ['graph TD; A-->B'],
    })
    const bare = page(doc)
    expect(bare).toContain('<span class="missing-image">a dot</span>')
    expect(bare).toContain('<code class="language-mermaid">graph TD; A--&gt;B</code>')
    const full = page(doc, {
      images: new Map([
        ['dot.png', 'data:image/png;base64,AA=='],
        ['[[shot.png]]', 'asset://shot'],
      ]),
      diagrams: new Map([['graph TD; A-->B', '<svg id="d"></svg>']]),
    })
    expect(full).toContain('<img src="data:image/png;base64,AA==" alt="a dot">')
    expect(full).toContain('<img src="asset://shot" alt="shot.png">')
    expect(full).toContain('<figure class="diagram"><svg id="d"></svg></figure>')
  })

  it('names the page and its language', () => {
    const state = EditorState.create({ doc: 'Заметка на русском', extensions: schedaSetup() })
    const html = renderPage(state, 'A <title>', none)
    expect(html).toContain('<html lang="ru">')
    expect(html).toContain('<title>A &lt;title&gt;</title>')
  })
})
