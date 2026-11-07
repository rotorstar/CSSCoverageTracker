import { normalizeHref } from '../core/collect/source-key'
import {
  type CoverageState,
  createState,
  mergeStates,
  selectorKey,
  upsertRoute,
  upsertSelector,
} from '../core/engine/state'
import { buildReport, type SourceTiming } from '../core/report/build'
import { toMarkdown } from '../core/report/exports'
import { selectorNames } from '../core/report/selector-classes'
import type { Report, ReportAtRules } from '../core/report/types'

/** Turn a report back into coverage state (epoch normalized, so independent runs merge). */
export function reportToState(report: Report): CoverageState {
  const state = createState(1)
  for (const s of report.selectors) {
    upsertSelector(state, {
      selector: s.selector,
      context: s.context,
      status: s.status,
      bytes: s.bytes,
      sources: s.sources,
      routes: s.routes,
      stale: s.stale,
    })
  }
  for (const r of report.routes)
    upsertRoute(state, { key: r.route, status: r.status, visits: r.visits })
  for (const s of report.sources) {
    state.sources.set(s.key, {
      key: s.key,
      href: s.href,
      kind: s.kind,
      media: s.media,
      readable: s.readable,
      serializedBytes: s.serializedBytes,
      renderBlocking: s.renderBlocking,
      framework: s.framework,
    })
  }
  for (const c of report.contexts) state.contexts.add(c)
  return state
}

function mergeAtRules(reports: readonly Report[]): ReportAtRules {
  const keyframes = new Map<string, { name: string; source: string; used: boolean }>()
  const fonts = new Map<string, boolean>()
  for (const report of reports) {
    for (const k of report.atRules.keyframes) {
      const existing = keyframes.get(k.name)
      keyframes.set(k.name, { ...k, used: (existing?.used ?? false) || k.used })
    }
    for (const f of report.atRules.fontFaces)
      fonts.set(f.family, (fonts.get(f.family) ?? false) || f.loaded)
  }
  return {
    keyframes: [...keyframes.values()],
    fontFaces: [...fonts].map(([family, loaded]) => ({ family, loaded })),
    counterStyles: [...new Set(reports.flatMap(r => r.atRules.counterStyles ?? []))],
  }
}

/** One entry of Playwright's `page.coverage.stopCSSCoverage()` (Chromium). */
export interface CdpCssCoverage {
  readonly url: string
  readonly text?: string
  readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>
}

/** Unused bytes per stylesheet from CDP coverage (byte-exact, but Chromium only and state-blind). */
export function cdpUnusedBytes(entries: readonly CdpCssCoverage[]): Map<string, number> {
  const unused = new Map<string, number>()
  for (const entry of entries) {
    if (entry.text === undefined) continue
    const used = entry.ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0)
    const key = normalizeHref(entry.url)
    unused.set(key, (unused.get(key) ?? 0) + Math.max(0, entry.text.length - used))
  }
  return unused
}

export interface MergeOptions {
  readonly version: string
  /** Imported Playwright CDP CSS coverage. */
  readonly cdp?: readonly CdpCssCoverage[]
  readonly knownRoutes?: readonly string[]
  readonly confidenceThreshold?: number
}

/** Union of reports from several runs, developers, viewports or browsers. */
export function mergeReports(reports: readonly Report[], options: MergeOptions): Report {
  const state = reports.map(reportToState).reduce((a, b) => mergeStates(a, b), createState(1))
  // stale only when every run that saw the selector saw it stale (independent of file order)
  const liveSomewhere = new Set(
    reports.flatMap(r =>
      r.selectors.filter(s => !s.stale).map(s => selectorKey(s.context, s.selector)),
    ),
  )
  for (const [key, record] of state.selectors) if (liveSomewhere.has(key)) record.stale = false
  const timings = new Map<string, SourceTiming>()
  const groups = new Map<string, string>()
  let jsReferences: Set<string> | null = null
  for (const report of reports) {
    for (const s of report.sources) {
      if (s.decodedBytes === null || s.encodedBytes === null) continue
      const previous = timings.get(s.key)
      timings.set(s.key, {
        decodedBytes: Math.max(previous?.decodedBytes ?? 0, s.decodedBytes),
        encodedBytes: Math.max(previous?.encodedBytes ?? 0, s.encodedBytes),
        renderBlocking: (previous?.renderBlocking ?? false) || s.renderBlocking === true,
      })
    }
    for (const s of report.selectors) {
      const key = selectorKey(s.context, s.selector)
      if (!groups.has(key)) groups.set(key, s.group)
      if (s.referencedInJs !== null) {
        jsReferences ??= new Set()
        if (s.referencedInJs) {
          const names = selectorNames(s.selector)
          for (const name of [...names.classes, ...names.ids]) jsReferences.add(name)
        }
      }
    }
  }
  return buildReport(state, {
    version: options.version,
    knownRoutes: [
      ...new Set([...reports.flatMap(r => r.knownRoutes), ...(options.knownRoutes ?? [])]),
    ],
    timings,
    groups,
    jsReferences,
    atRules: mergeAtRules(reports),
    ...(options.cdp ? { cdpUnused: cdpUnusedBytes(options.cdp) } : {}),
    warnings: [...new Set(reports.flatMap(r => r.warnings))],
    ...(options.confidenceThreshold === undefined
      ? {}
      : { confidenceThreshold: options.confidenceThreshold }),
  })
}

export interface ReportDiff {
  /** Selectors present before and gone (or stale) now — e.g. deleted during cleanup. */
  removedSelectors: string[]
  /** Unused now but used, state-dependent or absent before. */
  newlyUnused: string[]
  bytesBefore: number
  bytesAfter: number
  unusedBefore: number
  unusedAfter: number
  unusedGzipBefore: number
  unusedGzipAfter: number
}

export function diffReports(before: Report, after: Report): ReportDiff {
  const key = (s: { context: string; selector: string }): string =>
    selectorKey(s.context, s.selector)
  const now = new Map(after.selectors.map(s => [key(s), s]))
  const then = new Map(before.selectors.map(s => [key(s), s]))
  return {
    removedSelectors: before.selectors
      .filter(s => !s.stale && (now.get(key(s)) === undefined || now.get(key(s))?.stale === true))
      .map(s => s.selector),
    newlyUnused: after.selectors
      .filter(s => !s.stale && s.status === 'unused' && then.get(key(s))?.status !== 'unused')
      .map(s => s.selector),
    bytesBefore: before.summary.bytes.total,
    bytesAfter: after.summary.bytes.total,
    unusedBefore: before.summary.bytes.unused,
    unusedAfter: after.summary.bytes.unused,
    unusedGzipBefore: before.summary.bytes.unusedGzip,
    unusedGzipAfter: after.summary.bytes.unusedGzip,
  }
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

export function diffToMarkdown(diff: ReportDiff): string {
  const lines = [
    '# CSS coverage diff',
    '',
    `- Total CSS: ${kb(diff.bytesBefore)} → ${kb(diff.bytesAfter)} (${kb(diff.bytesBefore - diff.bytesAfter)} saved)`,
    `- Unused: ${kb(diff.unusedBefore)} → ${kb(diff.unusedAfter)} raw · ${kb(diff.unusedGzipBefore)} → ${kb(diff.unusedGzipAfter)} gzip`,
    `- Removed selectors: ${diff.removedSelectors.length}`,
    `- Newly unused selectors: ${diff.newlyUnused.length}`,
    ...diff.newlyUnused.slice(0, 50).map(s => `  - \`${s}\``),
  ]
  return `${lines.join('\n')}\n`
}

export interface CheckOptions {
  readonly maxUnusedKb?: number
  readonly maxUnusedPct?: number
  readonly baseline?: Report
  readonly noNewUnused?: boolean
  readonly minRouteCoverage?: number
}

export interface CheckResult {
  ok: boolean
  failures: string[]
  /** Markdown for the CI log / GitHub step summary. */
  summary: string
}

/** CI budget gate (plan D3). */
export function checkReport(report: Report, options: CheckOptions): CheckResult {
  const failures: string[] = []
  const unusedKb = report.summary.bytes.unused / 1024
  if (options.maxUnusedKb !== undefined && unusedKb > options.maxUnusedKb) {
    failures.push(
      `Unused CSS ${unusedKb.toFixed(1)} KB exceeds the budget of ${options.maxUnusedKb} KB`,
    )
  }
  if (options.maxUnusedPct !== undefined && report.summary.unusedPercent > options.maxUnusedPct) {
    failures.push(
      `Unused CSS ${report.summary.unusedPercent} % exceeds the budget of ${options.maxUnusedPct} %`,
    )
  }
  let newlyUnused: string[] = []
  if (options.noNewUnused && options.baseline) {
    newlyUnused = diffReports(options.baseline, report).newlyUnused
    if (newlyUnused.length > 0)
      failures.push(`${newlyUnused.length} selector(s) became unused since the baseline`)
  }
  if (options.minRouteCoverage !== undefined) {
    const ratio = report.coverage.ratio
    if (ratio === null || ratio < options.minRouteCoverage) {
      failures.push(
        ratio === null
          ? 'Route coverage unknown: provide known routes (--routes, knownRoutes or sitemap)'
          : `Route coverage ${Math.round(ratio * 100)} % is below ${Math.round(options.minRouteCoverage * 100)} %`,
      )
    }
  }
  const summary = [
    `## CSS coverage check: ${failures.length === 0 ? '✅ passed' : '❌ failed'}`,
    '',
    `- Unused: ${kb(report.summary.bytes.unused)} raw / ${kb(report.summary.bytes.unusedGzip)} gzip (${report.summary.unusedPercent} %)`,
    `- Routes: ${report.coverage.visited} visited${report.coverage.known === null ? '' : ` of ${report.coverage.known}`}`,
    ...failures.map(f => `- **${f}**`),
    ...newlyUnused.slice(0, 50).map(s => `  - newly unused: \`${s}\``),
    '',
  ].join('\n')
  return { ok: failures.length === 0, failures, summary }
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Standalone HTML report (no scripts, everything escaped). */
export function toHtml(report: Report): string {
  const rows = report.selectors
    .filter(s => s.status === 'unused' && !s.stale)
    .map(
      s =>
        `<tr><td><code>${escapeHtml(s.selector)}</code></td><td>${escapeHtml(s.sources.join(' '))}</td><td>${Math.round(s.bytes)}</td><td>${s.confidence ?? ''}</td></tr>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CSS coverage report</title>
<style>body{font:14px/1.5 system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}pre{white-space:pre-wrap}</style></head>
<body><pre>${escapeHtml(toMarkdown(report))}</pre>
<h2>Unused selectors</h2><table><thead><tr><th>Selector</th><th>Source</th><th>Bytes</th><th>Confidence</th></tr></thead><tbody>
${rows}
</tbody></table></body></html>
`
}
