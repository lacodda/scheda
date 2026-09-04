# Why astro and Starlight are pinned

The docs are built on `astro@7.2.9` with `@astrojs/starlight@0.41.9`, both
without a caret. The newer pair does not build this site cleanly:

- `astro@7.3.1` emits two warnings on every build that 7.2.9 does not —
  `The collection "i18n" does not exist or is empty` and
  `Entry docs → 404 was not found`. Neither is actionable here: declaring an
  `i18n` collection silences the first and leaves the second, and adding a
  `404` entry replaces the second with a route conflict against Starlight's own
  404 page. This site is English-only and has no 404 of its own to add.
- `@astrojs/starlight@0.42.0` requires a newer Astro to render `.mdx`, so it
  cannot be combined with the version that builds quietly.

The release ritual requires a docs build with no warnings, because a build that
always warns is a build nobody reads. The carets are dropped so an install
cannot drift back into the noise.

Revisit when Astro stops warning about collections a site does not have; the
pair then moves together.
