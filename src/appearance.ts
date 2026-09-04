// Applying what the settings say about how the window should look.
//
// Loaded after the first paint, like everything else that is not the text. The
// cost of that is a window that appears in the system theme and switches a
// frame later if the user chose otherwise; the alternative is a blank window
// while the settings file is read, which is worse in exactly the way this
// product exists to avoid.
import type { Settings } from './core'

/** Puts the settings into effect: the theme, the font size, the column width. */
export function apply(settings: Settings) {
  const root = document.documentElement

  // `system` means removing the attribute, not writing a third value: the
  // stylesheet's media query is what follows the OS, and it only gets a say
  // when nothing overrides it.
  if (settings.theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', settings.theme)
  }

  root.style.setProperty('--editor-font-size', `${settings.font_size}px`)
  // Zero means the full window, which is a reasonable thing to want on a wide
  // screen and impossible to express as a width.
  root.style.setProperty(
    '--column-width',
    settings.column_width > 0 ? `${settings.column_width}rem` : 'none',
  )
}
