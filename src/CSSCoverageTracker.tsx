/**
 * CSSCoverageTracker — A lightweight React dev tool that tracks CSS selector
 * usage across page navigations. Accumulates coverage data in localStorage,
 * displays a live badge with the unused-CSS percentage, and provides a
 * downloadable JSON report.
 *
 * Framework-agnostic: works with Next.js, Vite, CRA, Remix, or any React SPA.
 * Pass `pathname` for framework-specific route changes, or let the component
 * fall back to `window.location.pathname` with `popstate` listening.
 *
 * @example
 * // Next.js (app router)
 * 'use client'
 * import { usePathname } from 'next/navigation'
 * import { CSSCoverageTracker } from './CSSCoverageTracker'
 * export default function DevTools() {
 *   const pathname = usePathname()
 *   return <CSSCoverageTracker pathname={pathname} />
 * }
 *
 * @example
 * // Vite / CRA — auto-detects navigation via popstate
 * import { CSSCoverageTracker } from './CSSCoverageTracker'
 * function App() {
 *   return (
 *     <>
 *       <RouterOutlet />
 *       {import.meta.env.DEV && <CSSCoverageTracker />}
 *     </>
 *   )
 * }
 *
 * @license MIT
 */
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tracked data for a single CSS selector. */
export interface SelectorData {
  selector: string
  /** Whether this selector matched at least one DOM element across all visited pages. */
  matched: boolean
  /** Whether this selector lives inside a `@media print` block. */
  printOnly: boolean
  /** Stylesheet href or `"inline-<index>"` for inline `<style>` blocks. */
  source: string
}

/** Shape of the persisted coverage data in localStorage. */
export interface StorageData {
  selectors: Record<string, SelectorData>
  /** List of visited pathnames. */
  pages: string[]
  /** Unix-ms timestamp of the last scan. */
  lastScan: number
}

/** Badge position on the viewport. */
export type BadgePosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/** Configuration options — all optional with sensible defaults. */
export interface CSSCoverageConfig {
  /** localStorage key. @default 'css-coverage-tracker' */
  storageKey?: string
  /** Delay (ms) after navigation before scanning. @default 2000 */
  scanDelay?: number
  /** z-index of the badge and overlay. @default 50 */
  zIndex?: number
  /** Badge position on the viewport. @default 'bottom-left' */
  position?: BadgePosition
}

export interface CSSCoverageTrackerProps {
  /**
   * Current pathname — pass this from your router for instant navigation
   * detection. For Next.js: `usePathname()`. For React Router: `useLocation().pathname`.
   *
   * If omitted the component falls back to `window.location.pathname` and
   * listens to `popstate` events.
   */
  pathname?: string
  /** Optional configuration overrides. */
  config?: CSSCoverageConfig
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_STORAGE_KEY = 'css-coverage-tracker'
const DEFAULT_SCAN_DELAY = 2000
const DEFAULT_Z_INDEX = 50
const DEFAULT_POSITION: BadgePosition = 'bottom-left'

// ---------------------------------------------------------------------------
// Hoisted RegExp (avoids re-creation per call — js-hoist-regexp)
// ---------------------------------------------------------------------------

/** Matches CSS pseudo-elements like `::before`, `::after`, `::placeholder`. */
const PSEUDO_ELEMENT_RE = /::[a-z-]+(\([^)]*\))?/gi

/** Matches common CSS pseudo-classes (stateful/structural). */
const PSEUDO_CLASS_RE =
  /:(?:hover|focus|active|visited|focus-within|focus-visible|disabled|checked|first-child|last-child|nth-child\([^)]*\)|first-of-type|last-of-type|not\([^)]*\)|where\([^)]*\)|is\([^)]*\)|has\([^)]*\))/g

/** Matches a class-name prefix like `.glass-*` or `.brand-*`. */
const CLASS_PREFIX_RE = /^\.([a-z][\w]*)-/

// ---------------------------------------------------------------------------
// In-memory storage cache (js-cache-storage)
// ---------------------------------------------------------------------------

const storageCache = new Map<string, StorageData>()

function loadStorage(key: string): StorageData {
  const cached = storageCache.get(key)
  if (cached) return cached

  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as StorageData
      storageCache.set(key, parsed)
      return parsed
    }
  } catch {
    /* corrupted data — start fresh */
  }

  const empty: StorageData = { selectors: {}, pages: [], lastScan: 0 }
  storageCache.set(key, empty)
  return empty
}

function saveStorage(key: string, data: StorageData): void {
  storageCache.set(key, data)
  localStorage.setItem(key, JSON.stringify(data))
}

function clearStorage(key: string): void {
  storageCache.delete(key)
  localStorage.removeItem(key)
}

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/**
 * Strip pseudo-classes and pseudo-elements so the selector can be tested
 * against the live DOM with `querySelectorAll`.
 */
function stripPseudo(selector: string): string {
  return selector
    .replace(PSEUDO_ELEMENT_RE, '')
    .replace(PSEUDO_CLASS_RE, '')
    .trim()
}

/** Test whether a (stripped) selector matches any current DOM element. */
function selectorMatches(selector: string): boolean {
  const stripped = stripPseudo(selector)
  if (!stripped || stripped === '*') return true
  try {
    return document.querySelectorAll(stripped).length > 0
  } catch {
    return false // invalid selector
  }
}

// ---------------------------------------------------------------------------
// CSS rule extraction
// ---------------------------------------------------------------------------

interface ExtractedRule {
  selector: string
  printOnly: boolean
  source: string
}

/**
 * Recursively walk a `CSSRuleList` and extract every `CSSStyleRule` selector,
 * tracking whether it lives inside a `@media print` block.
 */
function extractRules(
  ruleList: CSSRuleList,
  source: string,
  isPrint = false,
): ExtractedRule[] {
  const results: ExtractedRule[] = []

  for (let i = 0; i < ruleList.length; i++) {
    const rule = ruleList[i]!

    if (rule instanceof CSSStyleRule) {
      const selectors = rule.selectorText.split(',').map(s => s.trim()).filter(Boolean)
      for (const sel of selectors) {
        results.push({ selector: sel, printOnly: isPrint, source })
      }
    } else if (rule instanceof CSSMediaRule) {
      const isPrintMedia = rule.conditionText === 'print'
      results.push(...extractRules(rule.cssRules, source, isPrint || isPrintMedia))
    } else if (rule instanceof CSSLayerBlockRule) {
      results.push(...extractRules(rule.cssRules, source, isPrint))
    } else if (rule instanceof CSSSupportsRule) {
      results.push(...extractRules(rule.cssRules, source, isPrint))
    } else if ('cssRules' in rule && rule.cssRules) {
      // CSSContainerRule or other nesting constructs
      results.push(...extractRules(rule.cssRules as CSSRuleList, source, isPrint))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Core scan logic
// ---------------------------------------------------------------------------

interface ScanResult {
  total: number
  matched: number
  pages: number
}

/**
 * Walk every accessible stylesheet, extract selectors, and test each one
 * against the current DOM. Results are OR-accumulated: once a selector is
 * marked as matched it stays matched across pages.
 */
function scanCSS(storageKey: string): ScanResult {
  const data = loadStorage(storageKey)
  const pathname = window.location.pathname

  if (!data.pages.includes(pathname)) {
    data.pages.push(pathname)
  }

  let sheetsProcessed = 0
  let sheetsSkipped = 0

  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i]!
    const source = sheet.href || `inline-${i}`

    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      sheetsSkipped++ // CORS — can't read cross-origin sheets
      continue
    }

    sheetsProcessed++
    const extracted = extractRules(rules, source)

    for (const { selector, printOnly, source: src } of extracted) {
      const existing = data.selectors[selector]

      if (!existing) {
        data.selectors[selector] = {
          selector,
          matched: printOnly ? false : selectorMatches(selector),
          printOnly,
          source: src,
        }
      } else if (!existing.matched && !printOnly) {
        // OR-accumulation: once matched on any page, stays matched
        if (selectorMatches(selector)) {
          existing.matched = true
        }
      }
    }
  }

  data.lastScan = Date.now()
  saveStorage(storageKey, data)

  if (typeof console !== 'undefined') {
    console.log(
      `[CSS Coverage] Sheets: ${sheetsProcessed} processed, ${sheetsSkipped} skipped (CORS). ` +
      `Selectors: ${Object.keys(data.selectors).length} total. Page: ${pathname}`,
    )
  }

  const total = Object.keys(data.selectors).length
  const matched = Object.values(data.selectors).filter(s => s.matched || s.printOnly).length
  return { total, matched, pages: data.pages.length }
}

// ---------------------------------------------------------------------------
// Grouping unused selectors by prefix
// ---------------------------------------------------------------------------

interface UnusedGroup {
  prefix: string
  selectors: string[]
  count: number
}

/**
 * Group all unmatched, non-print selectors by their class-name prefix
 * (e.g. `.glass-*`, `.brand-*`). Sorted by count descending.
 */
function groupUnused(storageKey: string): UnusedGroup[] {
  const data = loadStorage(storageKey)
  const unused = Object.values(data.selectors)
    .filter(s => !s.matched && !s.printOnly)
    .map(s => s.selector)

  const groups: Record<string, string[]> = {}
  for (const sel of unused) {
    const match = sel.match(CLASS_PREFIX_RE)
    const prefix = match ? `${match[1]}-*` : '_ungrouped'
    ;(groups[prefix] ??= []).push(sel)
  }

  return Object.entries(groups)
    .map(([prefix, selectors]) => ({ prefix, selectors, count: selectors.length }))
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Badge position helper
// ---------------------------------------------------------------------------

function positionStyles(position: BadgePosition, zIndex: number): React.CSSProperties {
  const base: React.CSSProperties = { position: 'fixed', zIndex }
  switch (position) {
    case 'bottom-left':  return { ...base, bottom: 16, left: 16 }
    case 'bottom-right': return { ...base, bottom: 16, right: 16 }
    case 'top-left':     return { ...base, top: 16, left: 16 }
    case 'top-right':    return { ...base, top: 16, right: 16 }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a fixed-position badge showing the current CSS coverage percentage.
 * Click the badge to open a full report overlay with grouped unused selectors,
 * a JSON download button, and a reset action.
 */
export function CSSCoverageTracker({ pathname, config }: CSSCoverageTrackerProps) {
  const storageKey = config?.storageKey ?? DEFAULT_STORAGE_KEY
  const scanDelay = config?.scanDelay ?? DEFAULT_SCAN_DELAY
  const zIndex = config?.zIndex ?? DEFAULT_Z_INDEX
  const position = config?.position ?? DEFAULT_POSITION

  const [mounted, setMounted] = useState(false)
  const [stats, setStats] = useState<ScanResult>({ total: 0, matched: 0, pages: 0 })
  const [showReport, setShowReport] = useState(false)
  const [groups, setGroups] = useState<UnusedGroup[]>([])
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // For popstate-based fallback when no pathname prop is provided
  const [fallbackPath, setFallbackPath] = useState('')

  const effectivePath = pathname ?? fallbackPath

  useEffect(() => {
    setMounted(true)
    if (pathname === undefined) {
      setFallbackPath(window.location.pathname)
    }
  }, [pathname])

  // Listen to popstate when no external pathname is provided
  useEffect(() => {
    if (pathname !== undefined) return
    const onPopState = () => setFallbackPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pathname])

  // Auto-scan after each navigation
  useEffect(() => {
    if (!mounted) return

    if (scanTimer.current) clearTimeout(scanTimer.current)
    scanTimer.current = setTimeout(() => {
      const result = scanCSS(storageKey)
      setStats(result)
    }, scanDelay)

    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current)
    }
  }, [effectivePath, mounted, scanDelay, storageKey])

  const handleOpenReport = useCallback(() => {
    setGroups(groupUnused(storageKey))
    setShowReport(true)
  }, [storageKey])

  // Single-pass report generation (js-combine-iterations)
  const handleDownload = useCallback(() => {
    const data = loadStorage(storageKey)
    const allSelectors = Object.values(data.selectors)

    const used: Array<{ selector: string; source: string }> = []
    const unused: Array<{ selector: string; source: string }> = []
    const printOnly: Array<{ selector: string; source: string }> = []

    for (const s of allSelectors) {
      const entry = { selector: s.selector, source: s.source }
      if (s.printOnly) {
        printOnly.push(entry)
      } else if (s.matched) {
        used.push(entry)
      } else {
        unused.push(entry)
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      pagesVisited: data.pages,
      summary: {
        totalSelectors: allSelectors.length,
        usedSelectors: used.length,
        unusedSelectors: unused.length,
        printOnlySelectors: printOnly.length,
      },
      unused,
      used,
      printOnly,
    }

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `css-coverage-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [storageKey])

  const handleReset = useCallback(() => {
    clearStorage(storageKey)
    setStats({ total: 0, matched: 0, pages: 0 })
    setGroups([])
    setShowReport(false)
    setExpandedGroup(null)
  }, [storageKey])

  if (!mounted) return null

  const unusedPct = stats.total > 0
    ? Math.round(((stats.total - stats.matched) / stats.total) * 100)
    : 0

  const badge = (
    <button
      onClick={handleOpenReport}
      style={{
        ...positionStyles(position, zIndex),
        padding: '6px 12px',
        background: unusedPct > 30 ? '#dc2626' : unusedPct > 15 ? '#d97706' : '#16a34a',
        color: 'white',
        borderRadius: 8,
        fontSize: 12,
        fontFamily: 'monospace',
        fontWeight: 600,
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'transform 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      CSS: {unusedPct}% unused ({stats.total - stats.matched}/{stats.total}) · {stats.pages}p
    </button>
  )

  const overlay = showReport ? (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: zIndex + 1,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => setShowReport(false)}
    >
      <div
        style={{
          background: '#1e1e2e',
          color: '#cdd6f4',
          borderRadius: 12,
          padding: 24,
          width: '90vw',
          maxWidth: 640,
          maxHeight: '80vh',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 13,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 18, color: '#cba6f7' }}>
          CSS Coverage Report
        </h2>

        <div style={{ marginBottom: 16, lineHeight: 1.8 }}>
          <div>Pages visited: <strong>{stats.pages}</strong></div>
          <div>Total selectors: <strong>{stats.total}</strong></div>
          <div style={{ color: '#a6e3a1' }}>
            Used: <strong>{stats.matched}</strong> ({stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0}%)
          </div>
          <div style={{ color: '#f38ba8' }}>
            Unused: <strong>{stats.total - stats.matched}</strong> ({unusedPct}%)
          </div>
        </div>

        <div style={{ borderTop: '1px solid #45475a', paddingTop: 12, marginBottom: 12 }}>
          <strong style={{ color: '#f38ba8' }}>Unused selectors (grouped):</strong>
        </div>

        {groups.length === 0 ? (
          <div style={{ color: '#a6e3a1', padding: 12 }}>All CSS is used!</div>
        ) : null}

        {groups.map(g => (
          <div key={g.prefix} style={{ marginBottom: 4 }}>
            <button
              onClick={() => setExpandedGroup(expandedGroup === g.prefix ? null : g.prefix)}
              style={{
                background: 'none',
                border: 'none',
                color: '#f9e2af',
                cursor: 'pointer',
                padding: '4px 0',
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            >
              {expandedGroup === g.prefix ? '\u25be' : '\u25b8'} {g.prefix} ({g.count})
            </button>
            {expandedGroup === g.prefix ? (
              <div style={{ paddingLeft: 20, color: '#9399b2', fontSize: 12, lineHeight: 1.6 }}>
                {g.selectors.map(s => <div key={s}>{s}</div>)}
              </div>
            ) : null}
          </div>
        ))}

        <div style={{
          display: 'flex',
          gap: 8,
          marginTop: 20,
          borderTop: '1px solid #45475a',
          paddingTop: 16,
        }}>
          <button
            onClick={handleDownload}
            style={{
              padding: '8px 16px',
              background: '#89b4fa',
              color: '#1e1e2e',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Download JSON
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '8px 16px',
              background: '#f38ba8',
              color: '#1e1e2e',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Reset
          </button>
          <button
            onClick={() => setShowReport(false)}
            style={{
              padding: '8px 16px',
              background: '#45475a',
              color: '#cdd6f4',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 12,
              marginLeft: 'auto',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  ) : null

  return createPortal(
    <>
      {badge}
      {overlay}
    </>,
    document.body,
  )
}
