import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Kept out of vite.config.ts on purpose: putting `test` there means the
// production build has to typecheck against vitest's types, and the build has
// no business knowing the tests exist.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The tab and pane tests mount real CodeMirror views. Asserting against
      // rendered spans is the only way to prove what the reader actually sees.
      environment: 'jsdom',
      // Both extensions: a test that renders a component is written in JSX,
      // and a pattern that only matched .test.ts let one sit in the repo
      // without ever running.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      // The rectangles jsdom does not have and CodeMirror asks for; see the
      // file for why a missing one fails tests at random. The editor package
      // keeps it, since every view it mounts needs it.
      setupFiles: ['packages/editor/test/dom.ts'],
      // The package runs under its own configuration — the one it is published
      // with — and this one adds the window's tests beside it.
      projects: ['packages/editor', { extends: true, test: { name: 'scheda' } }],
      // Not one worker per core. Each starts its own jsdom, and vitest gives a
      // worker sixty seconds to answer; with sixteen starting while cargo
      // builds beside them, some did not, and the gate went red on tests that
      // had not run. Four is the number kilna settled on for the same reason.
      maxWorkers: 4,
    },
  }),
)
