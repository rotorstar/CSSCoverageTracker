import { type CoverageState, selectorKey } from '../engine/state'
import type { SelectorStatus } from '../types'
import { selectorNames } from './selector-classes'
import type {
  Confidence,
  Report,
  ReportAtRules,
  ReportSelector,
  ReportSource,
  StatusCounts,
} from './types'

/** Typical gzip ratio of CSS; only used when neither transfer size nor a measured ratio is known. */
export const TYPICAL_CSS_GZIP_RATIO = 0.2

export interface SourceTiming {
  readonly decodedBytes: number
  readonly encodedBytes: number
  readonly renderBlocking: boolean | null
}

export interface ReportEnvironment {
  readonly version: string
  readonly now?: Date
  /** Route inventory (`knownRoutes`, sitemap, CLI `--routes`). */
  readonly knownRoutes?: readonly string[]
  /** Resource Timing per source key. */
  readonly timings?: ReadonlyMap<string, SourceTiming>
  /** Measured gzip ratio per source key (CompressionStream). */
  readonly gzipRatios?: ReadonlyMap<string, number>
  /** Class/id names found in same-origin scripts; `null` when not scanned. */
  readonly jsReferences?: ReadonlySet<string> | null
  /** selectorKey → rule group (selectors of one selector list). */
  readonly groups?: ReadonlyMap<string, string>
  /** Route coverage needed for "high" confidence. @default 0.9 */
  readonly confidenceThreshold?: number
  readonly warnings?: readonly string[]
  /** Unused @keyframes / @font-face (browser only). */
  readonly atRules?: ReportAtRules
  /** Unused bytes per source key from imported CDP coverage. */
  readonly cdpUnused?: ReadonlyMap<string, number>
}

function emptyCounts(): StatusCounts {
  return { used: 0, unused: 0, 'state-dependent': 0, print: 0, unknown: 0, stale: 0 }
}

/** Build the public report v2 from the accumulated coverage state. */
export function buildReport(state: CoverageState, env: ReportEnvironment): Report {
  const known = [...new Set(env.knownRoutes ?? [])]
  const visitedRoutes = [...state.routes.values()].filter(route => route.visits > 0)
  const visitedKeys = new Set(visitedRoutes.map(route => route.key))
  const ratio =
    known.length > 0 ? known.filter(r => visitedKeys.has(r)).length / known.length : null
  const allComplete = visitedRoutes.every(route => route.status === 'complete')
  const threshold = env.confidenceThreshold ?? 0.9
  const js = env.jsReferences ?? null

  const counts = emptyCounts()
  const selectors: ReportSelector[] = []
  const unusedBySource = new Map<string, number>()
  const serializedBySource = new Map<string, number>()
  const tailwindSources = new Set<string>()

  for (const record of state.selectors.values()) {
    const key = selectorKey(record.context, record.selector)
    const live = !record.stale
    if (record.stale) counts.stale++
    else counts[record.status]++
    for (const source of record.sources) {
      const share = record.bytes / Math.max(record.sources.length, 1)
      if (live) serializedBySource.set(source, (serializedBySource.get(source) ?? 0) + share)
      if (live && record.status === 'unused') {
        unusedBySource.set(source, (unusedBySource.get(source) ?? 0) + share)
      }
      if (record.context.includes('@layer utilities')) tailwindSources.add(source)
    }

    let referencedInJs: boolean | null = null
    let confidence: Confidence | null = null
    if (record.status === 'unused' && live) {
      if (js) {
        const names = selectorNames(record.selector)
        referencedInJs = [...names.classes, ...names.ids].some(name => js.has(name))
      }
      if (referencedInJs === true) confidence = 'low'
      else if (ratio !== null && ratio >= threshold && allComplete && referencedInJs === false) {
        confidence = 'high'
      } else confidence = 'medium'
    }

    selectors.push({
      selector: record.selector,
      context: record.context,
      status: record.status satisfies SelectorStatus,
      bytes: record.bytes,
      sources: [...record.sources],
      routes: [...record.routes],
      stale: record.stale,
      group: env.groups?.get(key) ?? key,
      referencedInJs,
      confidence,
    })
  }

  const sources: ReportSource[] = [...state.sources.values()].map(source => {
    const timing = env.timings?.get(source.key)
    const serialized = source.serializedBytes || Math.round(serializedBySource.get(source.key) ?? 0)
    const unusedSerialized = unusedBySource.get(source.key) ?? 0
    const factor = timing && serialized > 0 ? timing.decodedBytes / serialized : 1
    const unusedBytes = Math.round(unusedSerialized * factor)
    const gzipRatio =
      timing && timing.encodedBytes > 0 && timing.encodedBytes < timing.decodedBytes
        ? timing.encodedBytes / timing.decodedBytes
        : (env.gzipRatios?.get(source.key) ?? TYPICAL_CSS_GZIP_RATIO)
    return {
      key: source.key,
      href: source.href,
      kind: source.kind,
      media: source.media,
      readable: source.readable,
      renderBlocking: timing?.renderBlocking ?? source.renderBlocking,
      framework: source.framework ?? (tailwindSources.has(source.key) ? 'tailwind' : null),
      serializedBytes: serialized,
      decodedBytes: timing?.decodedBytes ?? null,
      encodedBytes: timing?.encodedBytes ?? null,
      unusedBytes,
      unusedGzipBytes: Math.round(unusedBytes * gzipRatio),
      cdpUnusedBytes: env.cdpUnused?.get(source.key) ?? null,
    }
  })

  const total = sources.reduce((sum, s) => sum + (s.decodedBytes ?? s.serializedBytes), 0)
  const unused = sources.reduce((sum, s) => sum + s.unusedBytes, 0)
  const countable = counts.used + counts.unused + counts['state-dependent'] + counts.unknown
  const unusedPercent =
    total > 0
      ? Math.round((unused / total) * 100)
      : countable > 0
        ? Math.round((counts.unused / countable) * 100)
        : 0

  const warnings = [...(env.warnings ?? [])]
  const unreadable = sources.filter(s => !s.readable)
  if (unreadable.length > 0) {
    warnings.push(
      `${unreadable.length} cross-origin stylesheet(s) could not be read (CORS): ${unreadable.map(s => s.key).join(', ')}`,
    )
  }

  return {
    schema: 'css-coverage/v2',
    generatedAt: (env.now ?? new Date()).toISOString(),
    tool: { name: 'css-coverage-tracker', version: env.version },
    epoch: state.epoch,
    contexts: [...state.contexts],
    routes: [...state.routes.values()].map(r => ({
      route: r.key,
      status: r.status,
      visits: r.visits,
    })),
    knownRoutes: known,
    coverage: {
      visited: visitedRoutes.length,
      known: known.length > 0 ? known.length : null,
      ratio,
      allComplete,
    },
    sources,
    selectors,
    atRules: env.atRules ?? { keyframes: [], fontFaces: [], counterStyles: [] },
    summary: {
      selectors: counts,
      bytes: {
        total,
        unused,
        unusedGzip: sources.reduce((sum, s) => sum + s.unusedGzipBytes, 0),
      },
      unusedPercent,
    },
    warnings,
  }
}
