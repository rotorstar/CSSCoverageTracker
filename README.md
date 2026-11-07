# CSS Coverage Tracker

Find unused CSS **safely** — at runtime, across navigations, tabs, developers and test runs.

CSS Coverage Tracker watches which CSS selectors your real pages use while you (or your E2E suite) click through the app. It tells you what is **unused**, what only matters in **interaction states** (open popovers, `:hover`, Bootstrap's `.show`, `[data-state=open]`), how many **KB** you would save per file and route, and how **confident** you can be before deleting anything.

```
CSS 24% unused · 38.4 KB · 8 routes          ← badge (bottom-left, isolated in a shadow root)
```

- **Never reports live CSS as unused.** A two-stage check separates `used` from `state-dependent`; anything it cannot evaluate is `unknown`, never `unused`. Verified against real Bootstrap 5.3, Tailwind 4.3 + shadcn/ui and Font Awesome 7 output in Chromium, Firefox and WebKit.
- **Understands modern CSS:** Tailwind escapes (`md:hover:`, `data-[state=open]:`), `:is()/:where()/:has()/:not()`, native nesting, `@scope`, `@layer`, `@container`, `@import`, adopted stylesheets, Shadow DOM and `:host()`.
- **Built for performance work:** unused KB raw and gzip per file (scaled to real file and transfer sizes), render-blocking flags, route-specific CSS (split candidates), unused `@keyframes`/`@font-face`, before/after diffs.
- **Cheap to run:** a token prefilter and ≤ 8 ms time slices keep the page responsive (0 long animation frames on 17k selectors / 9k nodes).
- **Automatable:** Playwright fixture, `css-coverage` CLI (`merge`, `report`, `diff`, `check`) and a CI budget gate.
- **Framework-agnostic:** React/Next.js adapter, `import 'css-coverage-tracker/auto'` for everything else, or a single `<script>` tag for legacy sites.

## Why another tool?

| Tool | What it misses |
| --- | --- |
| **Chrome DevTools Coverage** | Chromium only. Keeps data across client-side route changes, but resets on every reload or full page load, is never persisted or merged across sessions, tabs or developers, and counts `:hover`/`:focus` rules and JS-toggled classes as unused until they are triggered. |
| **Playwright/Puppeteer CSS coverage**, Project Wallace, monocart | CDP-based (Chromium only); miss styles injected without a `sourceURL` (CSS-in-JS, constructed stylesheets); unapplied interaction states look unused. Their byte-exact numbers can be added to a CSS Coverage Tracker report with `css-coverage merge … --cdp`. |
| **PurgeCSS, Tailwind content detection** | Static: they see class names in source files, not which ones render. Dynamic classes and dead code paths are guesses. |
| **UnCSS, DropCSS** | Unmaintained (last releases 2019/2020). |

CSS Coverage Tracker runs **in every browser, at runtime**, accumulates results **across navigations, reloads, tabs, developers and CI runs**, and grades each unused selector with a **deletion confidence**.

## Install

```bash
npm install --save-dev css-coverage-tracker@alpha
```

Requirements: an evergreen browser. Node ≥ 24 for the CLI and the Playwright fixture. React ≥ 18 only for the React adapter.

## Quick start

### Next.js (App Router)

`usePathname()`, `useParams()` and `next/dynamic` with `ssr: false` only work in Client Components, so the tracker gets its own client file:

```tsx
// app/dev-tools.tsx
'use client'

import dynamic from 'next/dynamic'
import { useParams, usePathname } from 'next/navigation'
import { routePattern } from 'css-coverage-tracker/react'

const CSSCoverageTracker = dynamic(
  () => import('css-coverage-tracker/react').then(m => m.CSSCoverageTracker),
  { ssr: false },
)

export function DevTools() {
  const pathname = usePathname()
  const params = useParams()
  return (
    <CSSCoverageTracker
      pathname={pathname}
      route={routePattern(pathname, params)}
      options={{ sitemap: true }}
    />
  )
}
```

Render it from the root layout only in development. The dynamic `import()` inside the guarded branch keeps the tracker out of production builds entirely:

```tsx
// app/layout.tsx
import type { ReactNode } from 'react'

export default async function RootLayout({ children }: { children: ReactNode }) {
  const DevTools =
    process.env.NODE_ENV === 'development' ? (await import('./dev-tools')).DevTools : null
  return (
    <html lang="en">
      <body>
        {children}
        {DevTools ? <DevTools /> : null}
      </body>
    </html>
  )
}
```

`routePattern()` groups `/blog/a` and `/blog/b` into `/blog/[slug]`; `sitemap: true` reads `/sitemap.xml` as route inventory (needed for high-confidence deletions).

### React Router, TanStack Router, any React app

```tsx
import { useLocation } from 'react-router'
import { CSSCoverageTracker } from 'css-coverage-tracker/react'

export function DevTools() {
  const { pathname } = useLocation()
  return <CSSCoverageTracker pathname={pathname} options={{ knownRoutes: ['/', '/settings'] }} />
}
```

Without a `pathname` prop the tracker follows navigations itself (Navigation API, with a `popstate`/`hashchange` fallback).

### Vite, Vue, Svelte, Astro, Solid, …

```ts
// main.ts
if (import.meta.env.DEV) import('css-coverage-tracker/auto')
```

Options can be set before the import: `window.__CSS_COVERAGE_CONFIG__ = { knownRoutes: ['/'] }`.

### Legacy sites, CMS, static HTML (no build step)

```html
<script
  src="https://unpkg.com/css-coverage-tracker@alpha/dist/css-coverage-tracker.iife.js"
  data-css-coverage='{"sitemap": true}'
></script>
```

The single file is also available as `dist/css-coverage-tracker.standalone.js` (ESM) for copy-paste setups. The panel works under strict Content Security Policy and Trusted Types: it only uses constructable stylesheets and never `innerHTML`.

## How a selector is classified

Every scan tests each selector in two stages:

| Status | Meaning | Safe to delete? |
| --- | --- | --- |
| `used` | The selector as written matches an element (pseudo-elements ignored). | No |
| `state-dependent` | Only matches once runtime state is ignored: `:hover`, `:focus-visible`, `:checked`, `[data-state=open]`, `[aria-expanded]`, `[open]`, `[hidden]`, Bootstrap's `.show`/`.collapsed`, `.is-*`/`.has-*` … Becomes `used` as soon as the state is observed (e.g. by your E2E suite). | Only if the state is unreachable |
| `unused` | Valid selector, nothing matches on any visited route. | Check the confidence |
| `print` | Lives in print-only media (`@media print`, `<link media="print">`). | Separately |
| `unknown` | Could not be evaluated safely. Never counted as unused. | No |

Results only ever move up (`unused → state-dependent → used`) within an audit. A rule that disappears from a stylesheet that is still loaded (you deleted it, HMR reloaded) becomes **stale** and drops out of the numbers automatically — no reset needed.

**Deletion confidence** for unused selectors:

- **high** — route coverage ≥ 90 % of the route inventory (`knownRoutes`, `sitemap`, CLI `--routes`), all visited routes fully scanned, and none of the selector's class names appear in your same-origin JavaScript.
- **medium** — no JavaScript references, but route coverage is unknown or incomplete.
- **low** — the class name appears in JavaScript (probably toggled at runtime). Verify by hand.

State lists are configurable (`options.state`, see `DEFAULT_STATE`).

## The report

Click the badge (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>) to open the report:

- **Files** — unused KB raw and gzip per stylesheet (scaled to the real file and transfer sizes from Resource Timing), unreadable cross-origin stylesheets.
- **Routes** — scan status per route and how many selectors are route-specific (used on only one route but loaded globally → split candidates).
- **Selectors** — filter by status and text, with confidence.
- **Exports** — JSON (report v2), CSV, Markdown, and build-tool exports (see below).
- **Rescan** and **New audit** (replaces v1's "Reset").

Cross-origin stylesheets that the browser does not let scripts read are listed as such; set `fetchCrossOrigin: true` to fetch them with CORS and analyze them too.

## Safe cleanup workflow

1. **Collect.** Browse the app (all routes, light and dark theme, a mobile viewport) and/or run your E2E suite with the Playwright fixture. Open popovers, dialogs and menus — or let the E2E suite do it.
2. **Merge.** `npx css-coverage merge coverage/css -o css-coverage.json --routes routes.txt`
3. **Read the report.** Start with the files with the most unused KB. Route-specific CSS in global stylesheets is a code-splitting opportunity.
4. **Delete.** The Markdown export contains a deletion list per file: *whole rules unused*, *selectors to remove from a selector list*, and *state-dependent selectors to verify*. Delete high-confidence items first.
5. **Or let the build do it.** For classes whose every selector is unused with high confidence, the exports feed your build:
   - Lightning CSS: `transform({ …, unusedSymbols })` with the exported `unusedSymbols` (it removes rules whose every selector references a listed class; mixed lists such as `h3, .h3` stay)
   - Tailwind v4: paste the exported `@source not inline("…");` lines into your CSS entry
   - PurgeCSS: add the exported `blocklist`
6. **Verify.** HMR rescans automatically; deleted rules become stale. `npx css-coverage diff before.json after.json` shows the KB saved and anything that became unused.
7. **Prevent regressions.** `npx css-coverage check css-coverage.json --max-unused-kb 50 --no-new-unused --baseline main.json`

### Proving the performance win

The tracker tells you what is safe to remove and how many bytes that is. Prove the user-facing effect with lab and field data:

- **Lighthouse CI** (`@lhci/cli`): compare the `unused-css-rules` and `render-blocking-resources` audits and LCP/FCP before and after.
- **web-vitals** in the field: LCP, FCP and INP from real users.
- For expensive selectors (style recalculation time), use the *Selector Stats* view of the Chrome DevTools Performance panel.

## Automation

### Playwright fixture

```ts
// tests/fixtures.ts — reuse your existing tests unchanged
export { test, expect } from 'css-coverage-tracker/playwright'
```

Every test writes a report to `coverage/css/`. Interactions in your tests (opening dialogs, menus, popovers) turn `state-dependent` selectors into `used` ones. Configure with `test.use({ cssCoverageDir: 'coverage/css', cssCoverageOptions: { knownRoutes: […] } })`.

### CLI

```bash
npx css-coverage merge coverage/css -o css-coverage.json --routes routes.txt \
  --cdp playwright-css-coverage.json   # optional: byte-exact Chromium data per file
npx css-coverage report css-coverage.json --format md     # md | html | csv | json
npx css-coverage report css-coverage.json --format lightningcss -o unused-symbols.json   # or tailwind | purgecss
npx css-coverage diff main.json css-coverage.json
npx css-coverage check css-coverage.json --max-unused-kb 50 --max-unused-pct 20 \
  --baseline main.json --no-new-unused --min-route-coverage 0.9
```

`check` exits with code 1 when a budget is exceeded and writes a summary to `$GITHUB_STEP_SUMMARY` when available.

```yaml
# .github/workflows/css-coverage.yml (excerpt)
- run: npx playwright test
- run: npx css-coverage check coverage/css --max-unused-kb 50 --routes routes.txt
```

### Programmatic API

```ts
import { createCoverageTracker } from 'css-coverage-tracker'

const tracker = createCoverageTracker({ knownRoutes: ['/', '/pricing'], ui: false })
await tracker.start()
// … later
const report = await tracker.getReport() // report v2 (JSON)
```

`analyzeSheet(sheet)` and `collectSheets(document)` classify a single stylesheet without any persistence.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `storageKey` | `'css-coverage-tracker'` | IndexedDB key; v1 localStorage data under this key is migrated. |
| `storage` | `'indexeddb'` | `'memory'` keeps data per page only. IndexedDB failures (quota) fall back to memory with a warning. |
| `knownRoutes` | `[]` | Route inventory for coverage and confidence. |
| `sitemap` | `false` | `true` or a URL: read routes from a same-origin sitemap. |
| `routeKey` | ids → `:id` | Map a URL to a route key. |
| `navigation` | `'auto'` | `'manual'`: call `tracker.notifyNavigation(route)` yourself. |
| `state` | `DEFAULT_STATE` | Attributes and classes treated as runtime state. |
| `exclude` | — | Elements that never count as usage. |
| `fetchCrossOrigin` | `false` | Fetch unreadable cross-origin stylesheets with CORS. |
| `scanScripts` | `true` | Search same-origin scripts for class names (deletion confidence). |
| `confidenceThreshold` | `0.9` | Route coverage required for high confidence. |
| `ui` / `position` | `true` / `'bottom-left'` | Badge and report panel. |
| `debounceMs` | `250` | Debounce for re-checks after DOM changes. |
| `force` / `mode` | `false` / auto | The tracker is a no-op in production builds unless forced. |
| `expose` | `false` | Expose the instance as `window.__CSS_COVERAGE__`. |

React props: `pathname`, `route`, `options` and the v1 `config` (`storageKey`, `scanDelay` → debounce, `position`; `zIndex` is obsolete because the badge lives in the browser's top layer).

## How it works

1. **Collect** every stylesheet the page uses: `document.styleSheets`, `@import`, `adoptedStyleSheets`, open shadow roots, and (opt-in) fetched cross-origin sheets.
2. **Walk** the CSSOM: nesting (`&` resolved to `:is(parent)`), `@scope`, `@media`/`@layer`/`@supports`/`@container` context, print media.
3. **Prepare** each selector once with a dependency-free tokenizer (escapes, strings, nested parentheses): the raw form, the state-normalized form and the tokens every match needs.
4. **Match** against the DOM. A token index of the DOM (classes, ids, tags, attributes) skips most `querySelector` calls; work runs in ≤ 8 ms slices (`scheduler.yield()`, MessageChannel fallback).
5. **Observe**: a MutationObserver re-checks only selectors whose tokens appear; new or changed stylesheets trigger a new pass; navigation via the Navigation API (`navigate` flushes the outgoing route before the URL changes); prerendering and the back/forward cache are handled.
6. **Persist** to IndexedDB (read-merge-write in one transaction) and sync tabs with BroadcastChannel.

Numbers from the benchmark (Chromium, 17,751 real selectors, 9,298 DOM nodes): v1 blocked the main thread for ~90 ms per navigation; v2 spends ~14 ms of main-thread time per navigation in ≤ 8 ms slices, with 0 long animation frames. Stored data is 23 % of v1's size.

## Limitations

- **Interaction states** are only `used` once they occur during a scan. Without E2E runs, interaction-heavy CSS stays `state-dependent` — that is intentional: it is not safe to delete.
- **JS-toggled classes** that are not in the state lists show as `unused` until they appear; the JavaScript reference check lowers their confidence, and your E2E suite can make them `used`.
- **Shadow DOM**: open shadow roots are analyzed; changes inside shadow roots are picked up on the next pass (navigation or *Rescan*). Closed shadow roots and iframes are not scanned.
- **`@scope … to (…)`** limits are ignored (selectors are treated as broader, never narrower).
- **Selector cost** (style recalculation time) is not measured; use DevTools Selector Stats.

## Migrating from v1

- Replace the copied `CSSCoverageTracker.tsx` with the package: `import { CSSCoverageTracker } from 'css-coverage-tracker/react'`. Props are compatible.
- Existing v1 data in localStorage is migrated on first start.
- The JSON export is now **report v2** (`schema: "css-coverage/v2"`), with bytes, routes, confidence and deletion groups. A JSON Schema ships as `dist/report.schema.json`.
- "Reset" is now "New audit".

## License

MIT — see [LICENSE](./LICENSE).
