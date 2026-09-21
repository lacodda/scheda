// Values the bundler substitutes at build time.
//
// `vite.config.ts` has defined `__APP_VERSION__` since the first build and
// nothing read it until the splash did, so there was nothing to declare it to
// TypeScript. Declared here rather than beside the splash because a build-time
// constant belongs to the build, not to whichever file happens to use it first.
//
// The tests see it too: `vitest.config.ts` merges the same vite config, so the
// substitution that makes this true in `dist/` is the one that makes it true
// under vitest.

/** The version in `package.json`, substituted at build time. */
declare const __APP_VERSION__: string
