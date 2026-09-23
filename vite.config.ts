import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
// The default import, not a named one: a JSON module has only a default export
// per spec, and Vite's native config loader — the default in a coming major —
// refuses the named form outright.
import manifest from './package.json' with { type: 'json' }

// Tauri serves the frontend from a fixed port and expects a static build in dist/.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  build: {
    // The chunks past the default 500 kB are mermaid's layout engines (elk,
    // cytoscape), reached only through the dynamic import in
    // `editor/mermaid.ts` when a diagram is first drawn in reading mode. They
    // are never part of starting the window, which is what the warning is
    // about; the startup path is held by `check:layout` and the startup log.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
