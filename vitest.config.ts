import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Kept out of vite.config.ts on purpose: putting `test` there means the
// production build has to typecheck against vitest's types, and the build has
// no business knowing the tests exist.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The decoration tests mount a real CodeMirror view. Asserting against
      // rendered spans is the only way to prove what the reader actually sees.
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  }),
)
