// The settings as the window holds them, and the one way to change them.
//
// The file is the core's (`settings.rs`). The window keeps the last answer it
// got, so every part of it that depends on a setting — the look, the editor,
// the keys, the settings screen itself — reads one copy and hears about one
// change. A change goes to the core as a patch and comes back as the whole
// settings, which is what is then held: the core clamps numbers and owns the
// recent list, and the window should show what was stored, not what it sent.
import { loadSettings, updateSettings, type Settings, type SettingsPatch } from './core'

let current: Settings | null = null
let loading: Promise<Settings> | null = null
let revision = 0
const listeners = new Set<() => void>()

function publish(next: Settings) {
  current = next
  revision += 1
  for (const listener of listeners) listener()
}

export const settings = {
  /** The settings, read from the core the first time they are asked for. */
  load(): Promise<Settings> {
    if (current) return Promise.resolve(current)
    loading ??= loadSettings().then((loaded) => {
      publish(loaded)
      return loaded
    })
    return loading
  },

  /** The last answer, or null before the first one arrives. */
  current: (): Settings | null => current,

  /** Changes some settings; everything listening hears the stored result. */
  async update(patch: SettingsPatch): Promise<Settings> {
    const next = await updateSettings(patch)
    publish(next)
    return next
  },

  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  revision: () => revision,
}
