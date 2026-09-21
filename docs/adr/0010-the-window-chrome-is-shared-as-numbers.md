# 0010 — The window's chrome is shared as numbers, not as a component

Accepted, 2026-09-21.

## Context

Every desktop product of the line draws its own title bar: the system draws
nothing under `decorations: false`, so dragging the window, double-clicking to
maximise, the three buttons and the edges you grab to resize are all the page's.
scheda made that trade first — the tabs live in the bar, which is what saves a
laptop screen the sixty pixels a separate tab strip under a system title bar
would cost — and kilna copied it.

Two products doing the same thing is what the line calls a primitive, so dowel
grew `window-frame` and `splash`, and the owner asked on 20.09.2026 for one
splash and one functional top bar across the desktop products.

dowel distributes primitives through a registry: a component is **copied** into
the product and becomes the product's own code. Those copies are written in
Tailwind classes and import `cn` from the `dowel-ui` package.

scheda has no Tailwind, and the refusal is written down. `src/editor/peek.ts`
records why the `PreviewCard` primitive was not used: it is built on Base UI,
`class-variance-authority`, Tailwind and `dowel-ui`, and "the product's first
rule is that nothing runs before the text is on screen, and four packages plus a
stylesheet for one hover card is exactly the thing that rule refuses" (ADR 0001).

Taking the primitives literally would therefore mean adding a PostCSS step and a
stylesheet in front of the first frame — and the stage that asked for this also
asked that the first-paint measurement not get worse. The two halves of the same
request contradict each other if "adopt" means "copy the file".

## Decision

**The behaviour and the geometry are shared; the implementation is not.**

`src/titlebar.tsx` stays scheda's own code, and is brought into line with
dowel's `window-frame` along the three axes that are what "one window chrome"
actually means:

- **The geometry, as numbers taken from dowel's tokens.** The bar is 40px rather
  than 2.4rem, a window button 46px rather than 2.9rem, a grab strip 5px and a
  corner 10px rather than 4 and 8. These live in `src/styles.css` as
  `--titlebar-height`, `--window-button-width`, `--resize-edge` and
  `--resize-corner`.
- **The behaviour, down to the defects it remembers.** The drag starts on the
  first movement rather than on the press (starting it on `pointerdown` ate the
  second click of every double click), the resize strips leave when the window
  is maximised, the maximised icon follows the window rather than our last click.
- **The guard against there being no window.** Every call goes through
  `currentWindow()`, which answers null outside Tauri, so the chrome renders and
  does nothing rather than throwing on the first click. scheda renders its chrome
  outside Tauri more often than inside it: the layout gate loads the built page
  in a plain browser, and so does every preview page in `tools/`.

The splash follows from the same reasoning and one further rule of the owner's:
it is raised lazily, after ~250ms, and **only on a cold start with nothing to
open**. A launch with a file never produces one. `index.html` gets no static
half — that half exists to fill the gap before the bundle arrives, and filling
that gap with anything but the text is precisely what this product refuses.

`dowel-ui` is a **devDependency**: scheda ships none of its code and only has to
keep agreeing with its numbers at build time.

## Consequences

scheda keeps its own frame code, so it can drift from the registry. Drift is
answered by a gate rather than by hope: `src/chrome.test.ts` reads dowel's
`theme.css` out of `node_modules` and scheda's `styles.css` off disk, and fails
when a number in one is not the number in the other.

That gate is not theoretical. kilna copied the primitive, and its copy has
already drifted: it holds `w-[46px]` and `EDGE = 5` where the registry now holds
`var(--spacing-window-button)` and `var(--spacing-resize-edge)`. Copying the file
did not prevent the drift the tokens exist to prevent — only reading the source
does.

The first-paint promise is held by the build's shape rather than by a stopwatch.
`tools/check-layout.mjs` checks that the entry chunk carries none of the chrome,
and that no splash appears on a page launched with a file. A stopwatch on this
machine is worth little; the ordering is checkable exactly.

What dowel's primitives are missing is to be added **in dowel**, not worked
around here. Two things are already known to differ and are deliberate:
`WindowButtons` takes an `onClose` callback, because scheda's unsaved-work guard
listens for the window's close *request* and the button must ask for the same
thing the system's own close does; and the splash's timing is scheda's, for the
reason above.
