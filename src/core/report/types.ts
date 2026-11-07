import type { SelectorStatus } from '../types'

/**
 * Report v2 — public exchange format (browser → Playwright fixture → CLI).
 * Verified against the Zod schema in `src/schema/report.ts` by a compile-time
 * equality check, so the two can never drift apart.
 */
export type Confidence = 'high' | 'medium' | 'low'

export interface ReportSelector {
  selector: string
  /** Enclosing at-rules (`@media … > @layer …`); '' at top level. */
  context: string
  status: SelectorStatus
  /** Serialized bytes of the rule share (UTF-8). */
  bytes: number
  sources: string[]
  routes: string[]
  stale: boolean
  /** Selectors of the same rule (selector list) share a group id. */
  group: string
  /** Unused only: class names of the selector appear in same-origin JavaScript. */
  referencedInJs: boolean | null
  /** Unused only: how safe deleting it is. */
  confidence: Confidence | null
}

export interface ReportSource {
  key: string
  href: string | null
  kind: 'link' | 'style' | 'import' | 'adopted' | 'shadow' | 'fetched'
  media: string
  readable: boolean
  renderBlocking: boolean | null
  framework: 'tailwind' | null
  serializedBytes: number
  /** File size from Resource Timing (uncompressed / transfer). */
  decodedBytes: number | null
  encodedBytes: number | null
  unusedBytes: number
  unusedGzipBytes: number
  /** Bytes never applied according to imported Chromium CDP coverage (CLI `--cdp`); null when not imported. */
  cdpUnusedBytes: number | null
}

export interface ReportRoute {
  route: string
  status: 'pending' | 'partial' | 'complete'
  visits: number
}

export interface StatusCounts {
  used: number
  unused: number
  'state-dependent': number
  print: number
  unknown: number
  stale: number
}

export interface ReportAtRules {
  /** @keyframes and whether a live (not unused) rule references them. */
  keyframes: Array<{ name: string; source: string; used: boolean }>
  /** @font-face families and whether the browser ever loaded them. */
  fontFaces: Array<{ family: string; loaded: boolean }>
  /** @counter-style names (symbols that build tools may remove). */
  counterStyles: string[]
}

export interface Report {
  schema: 'css-coverage/v2'
  generatedAt: string
  tool: { name: string; version: string }
  epoch: number
  contexts: string[]
  routes: ReportRoute[]
  knownRoutes: string[]
  coverage: {
    visited: number
    known: number | null
    /** visited ∩ known / known; null without a route inventory. */
    ratio: number | null
    allComplete: boolean
  }
  sources: ReportSource[]
  selectors: ReportSelector[]
  atRules: ReportAtRules
  summary: {
    selectors: StatusCounts
    bytes: { total: number; unused: number; unusedGzip: number }
    unusedPercent: number
  }
  warnings: string[]
}
