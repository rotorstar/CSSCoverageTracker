---
"css-coverage-tracker": minor
---

Route inventory and grouping for large sites:

- `sitemap` follows a sitemap index into its same-origin child sitemaps (plain or `.xml.gz`) instead of counting the sitemap files as routes.
- The default route key also collapses slugs that end in an id (`title---<uuid>`, `name_<hash>`, `title-1234567`) into `:slug`.
- New `routePatterns` option (`['/jobs/:slug', '/docs/*']`): JSON-safe route grouping, usable from the Playwright fixture where `routeKey` functions cannot be passed. The fixture's `cssCoverageOptions` is now typed.
- `idle()` (and so `getReport()`) now waits for a `start()` that is still booting, so the Playwright fixture never writes an empty report on a slow machine.
- The report dialog shows "Collecting…" instead of the previous report's controls while it refreshes, so input right after opening is not lost.
