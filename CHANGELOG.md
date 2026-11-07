# css-coverage-tracker

## 2.0.0-alpha.0

### Major Changes

- 01fe31a: v2: CSS Coverage Tracker becomes an npm package with an accuracy-first engine.
  
  - **Never reports live CSS as unused:** two-stage classification (`used` / `state-dependent` / `unused` / `print` / `unknown`), a dependency-free selector tokenizer (Tailwind escapes, `:is()/:where()/:has()/:not()`, nested parentheses), native CSS nesting, `@scope`, `@import`, adopted stylesheets, Shadow DOM and `:host()`, print media, configurable state attributes/classes (Radix, Base UI, React Aria, Bootstrap JS).
  - **Performance:** token prefilter, ≤ 8 ms time slices, incremental re-checks after DOM mutations, Navigation API with pre-commit flush, prerender/bfcache handling. 0 long animation frames on 17k selectors / 9k nodes.
  - **Persistence:** IndexedDB with read-merge-write transactions, BroadcastChannel multi-tab merge, v1 localStorage migration, memory fallback; stale detection for deleted rules.
  - **Insights:** report v2 (JSON Schema included) with unused KB raw/gzip per file (Resource Timing), render-blocking flags, route attribution and route inventory (`knownRoutes`, sitemap), deletion confidence (JS references), deletion plan, unused `@keyframes`/`@font-face`, CSV/Markdown/HTML exports and Lightning CSS / Tailwind / PurgeCSS remediation exports behind a confidence gate.
  - **UI:** isolated panel (shadow root, constructable stylesheets, top layer, `<dialog>`), CSP- and Trusted-Types-safe, keyboard accessible (axe: 0 violations).
  - **Entry points:** `css-coverage-tracker` (core API), `/react` (v1-compatible props), `/auto`, `/playwright` (fixture), single-file IIFE/ESM builds, and the `css-coverage` CLI (`merge`, `report`, `diff`, `check`, `--cdp` import).
  - **Breaking:** the JSON export is now report v2; "Reset" became "New audit"; `zIndex` is ignored (top layer).

### Minor Changes

- d8db507: Route inventory and grouping for large sites:
  
  - `sitemap` follows a sitemap index into its same-origin child sitemaps (plain or `.xml.gz`) instead of counting the sitemap files as routes.
  - The default route key also collapses slugs that end in an id (`title---<uuid>`, `name_<hash>`, `title-1234567`) into `:slug`.
  - New `routePatterns` option (`['/jobs/:slug', '/docs/*']`): JSON-safe route grouping, usable from the Playwright fixture where `routeKey` functions cannot be passed. The fixture's `cssCoverageOptions` is now typed.
  - `idle()` (and so `getReport()`) now waits for a `start()` that is still booting, so the Playwright fixture never writes an empty report on a slow machine.
  - The report dialog shows "Collecting…" instead of the previous report's controls while it refreshes, so input right after opening is not lost.
