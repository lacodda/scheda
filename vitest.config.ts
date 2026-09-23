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
      // Both extensions: a test that renders a component is written in JSX,
      // and a pattern that only matched .test.ts let one sit in the repo
      // without ever running.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      // The rectangles jsdom does not have and CodeMirror asks for; see the
      // file for why a missing one fails tests at random.
      setupFiles: ['src/test/dom.ts'],
    },
  }),
)
