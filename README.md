# CSS Coverage Tracker

A lightweight React development tool that tracks CSS selector usage across page navigations. It accumulates coverage data in `localStorage`, shows a live badge with the unused-CSS percentage, and lets you download a detailed JSON report.

**Zero dependencies** beyond React 18+. No build step required — drop the single `.tsx` file into your project.

## The Problem

CSS only grows — it never shrinks. Unlike JavaScript, unused CSS selectors don't throw errors. They silently accumulate over months and years: old component styles survive redesigns, utility classes from abandoned experiments linger, framework upgrades leave behind deprecated patterns. The result is bloated stylesheets that slow down FCP/LCP, waste bandwidth, and make maintenance painful.

**Existing tools fall short:**

| Tool | Limitation |
|------|------------|
| **Chrome DevTools Coverage** | Single-page snapshot. Resets on every navigation. No way to track coverage across your whole app. |
| **PurgeCSS / UnCSS** | Build-time static analysis. Misses dynamically toggled classes, JS-driven states, and conditional renders. Can accidentally strip styles you actually need. |
| **Stylelint** | Lints syntax and conventions — doesn't know which selectors match real DOM elements at runtime. |

CSS Coverage Tracker fills the gap: it runs **in the browser, at runtime**, accumulates results **across navigations**, and gives you a **concrete list** of selectors that never matched any DOM element.

## When to Use This

- **Legacy CSS cleanup** — You inherited a codebase with years of accumulated styles and need to know what's actually used before deleting anything
- **CSS framework migration** — Moving from Bootstrap to Tailwind, or Tailwind v3 to v4? Find which old utility classes are still referenced
- **Design system audit** — Discover which component styles are actually used across the app vs. exported but never imported
- **Post-redesign cleanup** — After a visual refresh, identify selectors left over from the old design
- **Bundle size optimization** — Your CSS is 200 KB+ and you need data to prioritize what to cut
- **Pre-migration analysis** — Before moving to CSS-in-JS or CSS Modules, understand your current selector landscape
- **Continuous monitoring** — Run periodic audits during development to catch CSS bloat before it ships

## What it does

1. After each page navigation, it walks every accessible `<style>` and `<link>` stylesheet
2. Extracts all CSS selectors (including nested `@media`, `@layer`, `@supports`, `@container`)
3. Tests each selector against the live DOM via `querySelectorAll`
4. OR-accumulates results: once a selector matches on *any* page, it stays marked as "used"
5. Displays a color-coded badge: green (< 15% unused), orange (15–30%), red (> 30%)
6. Click the badge to see a grouped report and download JSON

## Features

- **Framework-agnostic** — works with Next.js, Vite, CRA, Remix, React Router, or any SPA
- **Cumulative tracking** — browse your whole app, coverage data persists in localStorage
- **Grouped report** — unused selectors grouped by class-name prefix (`.glass-*`, `.brand-*`, etc.)
- **JSON export** — download a structured report with used/unused/print-only selectors
- **Configurable** — storage key, scan delay, z-index, badge position
- **Print-aware** — `@media print` selectors tracked separately (not flagged as unused)
- **CORS-safe** — gracefully skips cross-origin stylesheets it can't read
- **Pseudo-class stripping** — correctly handles `:hover`, `::before`, `:nth-child()`, etc.

## Installation

Copy `src/CSSCoverageTracker.tsx` into your project. That's it — single file, no npm package (yet).

```bash
cp src/CSSCoverageTracker.tsx your-project/src/components/dev/
```

## Usage

### Next.js (App Router)

In your root `layout.tsx`, dynamically import the component so it's excluded from production bundles:

```tsx
// src/app/layout.tsx
import dynamic from 'next/dynamic'

const CSSCoverageTracker = dynamic(
  () => import('@/components/dev/CSSCoverageTracker')
    .then(m => ({ default: m.CSSCoverageTracker })),
)

function DevTools() {
  'use client'
  const pathname = usePathname()
  return <CSSCoverageTracker pathname={pathname} />
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <DevTools />}
      </body>
    </html>
  )
}
```

> **Why `next/dynamic`?** It ensures the tracker's code is fully tree-shaken in production builds. The `process.env.NODE_ENV` guard alone would still include the import in the bundle.

### Vite / CRA / plain React

```tsx
import { CSSCoverageTracker } from './components/dev/CSSCoverageTracker'

function App() {
  return (
    <>
      <RouterOutlet />
      {import.meta.env.DEV && <CSSCoverageTracker />}
    </>
  )
}
```

Without a `pathname` prop the component automatically listens to `popstate` events. This covers browser back/forward navigation. For `pushState`-based routers (React Router, TanStack Router), pass the pathname explicitly:

```tsx
import { useLocation } from 'react-router-dom'

function DevTools() {
  const { pathname } = useLocation()
  return <CSSCoverageTracker pathname={pathname} />
}
```

### Remix

```tsx
import { useLocation } from '@remix-run/react'

function DevTools() {
  const { pathname } = useLocation()
  return <CSSCoverageTracker pathname={pathname} />
}
```

## Configuration

All options are optional:

```tsx
<CSSCoverageTracker
  pathname={pathname}
  config={{
    storageKey: 'my-css-tracker',   // default: 'css-coverage-tracker'
    scanDelay: 3000,                 // default: 2000 (ms after navigation)
    zIndex: 9999,                    // default: 50
    position: 'bottom-right',       // default: 'bottom-left'
  }}
/>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storageKey` | `string` | `'css-coverage-tracker'` | localStorage key for persisted data |
| `scanDelay` | `number` | `2000` | Milliseconds to wait after navigation before scanning |
| `zIndex` | `number` | `50` | z-index for badge and overlay |
| `position` | `BadgePosition` | `'bottom-left'` | Badge placement: `'bottom-left'` \| `'bottom-right'` \| `'top-left'` \| `'top-right'` |

## The Badge

The badge shows:

```
CSS: 24% unused (312/1298) · 8p
       │            │   │     └─ pages visited
       │            │   └─────── total selectors
       │            └─────────── unused selectors
       └──────────────────────── unused percentage
```

Color coding:
- **Green** — less than 15% unused
- **Orange** — 15–30% unused
- **Red** — more than 30% unused

## JSON Report Format

Click **Download JSON** in the report overlay to get:

```json
{
  "generatedAt": "2026-02-19T10:30:00.000Z",
  "pagesVisited": ["/", "/about", "/dashboard"],
  "summary": {
    "totalSelectors": 1298,
    "usedSelectors": 986,
    "unusedSelectors": 280,
    "printOnlySelectors": 32
  },
  "unused": [
    { "selector": ".glass-morphism", "source": "inline-3" },
    { "selector": ".brand-gradient-alt", "source": "https://example.com/styles.css" }
  ],
  "used": [...],
  "printOnly": [...]
}
```

## How It Works

### Selector Extraction

The tracker recursively walks `CSSRuleList` trees, handling:
- `CSSStyleRule` — extracts and splits comma-separated selectors
- `CSSMediaRule` — recurses, flagging `@media print` as print-only
- `CSSLayerBlockRule` — recurses (CSS `@layer`)
- `CSSSupportsRule` — recurses (`@supports`)
- `CSSContainerRule` and other nesting — generic `cssRules` fallback

### DOM Testing

Each selector is stripped of pseudo-classes (`:hover`, `:focus`, `:nth-child()`, etc.) and pseudo-elements (`::before`, `::after`) before testing with `querySelectorAll`. This means:

- `.btn:hover` is tested as `.btn`
- `.card::before` is tested as `.card`
- Pure pseudo selectors like `::selection` are treated as always matching

### OR-Accumulation

Coverage data is cumulative. If `.sidebar` doesn't match on the homepage but matches on `/dashboard`, it's marked as "used" globally. This is why visiting more pages gives more accurate results.

### Storage Caching

localStorage reads are cached in memory to avoid expensive synchronous I/O on repeated scans (follows the [Vercel React Best Practices](https://github.com/vercel/next.js) `js-cache-storage` pattern).

## Limitations

- **CORS stylesheets** — External stylesheets from other domains can't be read due to browser security. These are silently skipped (logged as "skipped (CORS)").
- **Dynamic styles** — CSS-in-JS libraries (styled-components, Emotion) inject styles after render. The 2-second scan delay helps, but some dynamic styles may be missed.
- **Pseudo-class accuracy** — `:hover` selectors are tested without the pseudo-class, so `.btn:hover` is marked "used" if `.btn` exists in the DOM, even if users never hover it.
- **JavaScript-toggled classes** — Classes added via JS after user interaction (modals, dropdowns) may not be captured unless you trigger those interactions during your browsing session.
- **iframe styles** — Stylesheets inside iframes are not scanned.

## Tips for Accurate Results

1. **Visit every route** — The more pages you visit, the more accurate the report
2. **Interact with the UI** — Open modals, dropdowns, tooltips to expose dynamic classes
3. **Check the page count** — The badge shows how many pages contributed to the data
4. **Use the Reset button** — Clear old data when starting a fresh audit
5. **Compare over time** — Download JSON reports before and after CSS cleanup

## Performance

The component is designed to have minimal impact on development performance:

- Scans run on a debounced timer (default 2s after navigation), never during interaction
- RegExp patterns are hoisted to module scope (not recreated per call)
- localStorage reads are cached in memory
- The component only renders a small fixed badge — the overlay is conditional

## License

MIT — see [LICENSE](./LICENSE).
