import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'editor',
    // The tests mount a real CodeMirror view. Asserting against rendered spans
    // is the only way to prove what the reader actually sees.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // The rectangles jsdom does not have and CodeMirror asks for; see the file
    // for why a missing one fails tests at random.
    setupFiles: ['test/dom.ts'],
    // Four, as in the window's configuration, and for the same reason: each
    // worker starts its own jsdom. The two have to agree — vitest refuses to
    // run projects of one group on different numbers of workers.
    maxWorkers: 4,
  },
})
