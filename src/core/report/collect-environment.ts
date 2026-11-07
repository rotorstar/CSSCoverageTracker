import { normalizeHref, sourceKey } from '../collect/source-key'
import { collectSheets, walkSheet } from '../collect/walk-cssom'
import { type CoverageState, selectorKey } from '../engine/state'
import type { ReportEnvironment, SourceTiming } from './build'
import type { ReportAtRules } from './types'

interface TimingEntry {
  readonly name: string
  readonly initiatorType: string
  readonly decodedBodySize: number
  readonly encodedBodySize: number
  readonly renderBlockingStatus?: string
}

function isTimingEntry(entry: PerformanceEntry): entry is PerformanceEntry & TimingEntry {
  return 'decodedBodySize' in entry && 'initiatorType' in entry
}

function resourceEntries(): TimingEntry[] {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return []
  return performance.getEntriesByType('resource').filter(isTimingEntry)
}

/** File and transfer sizes of stylesheets (same-origin or Timing-Allow-Origin). */
export function stylesheetTimings(): Map<string, SourceTiming> {
  const timings = new Map<string, SourceTiming>()
  for (const entry of resourceEntries()) {
    if (entry.decodedBodySize <= 0) continue
    const status = entry.renderBlockingStatus
    timings.set(normalizeHref(entry.name), {
      decodedBytes: entry.decodedBodySize,
      encodedBytes: entry.encodedBodySize,
      renderBlocking: status === undefined ? null : status === 'blocking',
    })
  }
  return timings
}

async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return (await new Response(stream).arrayBuffer()).byteLength
}

/** Measured gzip ratio per source and rule groups (selectors of one list) of the live CSSOM. */
export async function sheetFacts(
  doc: Document,
  exclude: (element: Element) => boolean,
): Promise<{ gzipRatios: Map<string, number>; groups: Map<string, string> }> {
  const gzipRatios = new Map<string, number>()
  const groups = new Map<string, string>()
  const ruleIds = new Map<CSSStyleRule, string>()
  const entries = collectSheets(doc, exclude)
  for (const [position, { sheet }] of entries.entries()) {
    const key = sourceKey(sheet, position)
    let text: string
    try {
      text = Array.from(sheet.cssRules, rule => rule.cssText).join('\n')
    } catch {
      continue
    }
    for (const walked of walkSheet(sheet, key, false)) {
      let id = ruleIds.get(walked.rule)
      if (!id) {
        id = `r${ruleIds.size + 1}`
        ruleIds.set(walked.rule, id)
      }
      groups.set(selectorKey(walked.context, walked.selector), id)
    }
    if (text.length > 0 && typeof CompressionStream !== 'undefined') {
      gzipRatios.set(key, (await gzipSize(text)) / new TextEncoder().encode(text).length)
    }
  }
  return { gzipRatios, groups }
}

function keyframeNames(rules: CSSRuleList, out: string[], counters?: Set<string>): void {
  for (const rule of Array.from(rules)) {
    if (typeof CSSCounterStyleRule !== 'undefined' && rule instanceof CSSCounterStyleRule) {
      counters?.add(rule.name)
    } else if (rule instanceof CSSKeyframesRule) out.push(rule.name)
    else if (rule instanceof CSSImportRule) {
      try {
        if (rule.styleSheet) keyframeNames(rule.styleSheet.cssRules, out, counters)
      } catch {
        /* cross-origin import */
      }
    } else if (rule instanceof CSSGroupingRule) keyframeNames(rule.cssRules, out, counters)
  }
}

/**
 * Unused @keyframes (no live rule references them) and @font-face families
 * the browser never loaded (plan C7).
 */
export function atRuleFacts(
  doc: Document,
  exclude: (element: Element) => boolean,
  state: CoverageState,
): ReportAtRules {
  const defined = new Map<string, string>()
  const referenced = new Set<string>()
  const counterStyles = new Set<string>()
  for (const [position, { sheet }] of collectSheets(doc, exclude).entries()) {
    const key = sourceKey(sheet, position)
    try {
      const names: string[] = []
      keyframeNames(sheet.cssRules, names, counterStyles)
      for (const name of names) if (!defined.has(name)) defined.set(name, key)
    } catch {
      continue
    }
    for (const walked of walkSheet(sheet, key, false)) {
      const record = state.selectors.get(selectorKey(walked.context, walked.selector))
      if (!record || record.stale || record.status === 'unused') continue
      for (const name of walked.rule.style.animationName.split(',')) {
        const trimmed = name.trim()
        if (trimmed && trimmed !== 'none') referenced.add(trimmed)
      }
    }
  }
  const fontFaces = new Map<string, boolean>()
  for (const face of doc.fonts ?? []) {
    const family = face.family.replace(/^["']|["']$/g, '')
    const loaded = face.status === 'loaded' || face.status === 'loading'
    fontFaces.set(family, (fontFaces.get(family) ?? false) || loaded)
  }
  return {
    keyframes: [...defined].map(([name, source]) => ({ name, source, used: referenced.has(name) })),
    fontFaces: [...fontFaces].map(([family, loaded]) => ({ family, loaded })),
    counterStyles: [...counterStyles],
  }
}

const scriptTokens = new Map<string, Set<string>>()

/**
 * Class/id-like tokens of same-origin scripts (plan C6). A selector whose names
 * appear in JavaScript may be toggled at runtime → lower deletion confidence.
 */
export async function javascriptReferences(doc: Document): Promise<Set<string>> {
  const all = new Set<string>()
  const urls = new Set<string>()
  for (const entry of resourceEntries()) if (entry.initiatorType === 'script') urls.add(entry.name)
  for (const script of Array.from(doc.scripts)) {
    if (script.src) urls.add(script.src)
    else for (const token of script.textContent?.match(/[\w-]+/g) ?? []) all.add(token)
  }
  const origin = doc.location.origin
  await Promise.all(
    [...urls]
      .filter(url => new URL(url, doc.baseURI).origin === origin)
      .map(async url => {
        let tokens = scriptTokens.get(url)
        if (!tokens) {
          tokens = new Set<string>()
          try {
            const text = await (await fetch(url, { credentials: 'same-origin' })).text()
            for (const token of text.match(/[\w-]+/g) ?? []) tokens.add(token)
          } catch {
            /* unreachable script: no tokens */
          }
          scriptTokens.set(url, tokens)
        }
        for (const token of tokens) all.add(token)
      }),
  )
  return all
}

const sitemapCache = new Map<string, Promise<string[]>>()
/** Child sitemaps read from one index (large sites split into many files). */
const MAX_CHILD_SITEMAPS = 200

/** Sitemap text; `.xml.gz` files served without Content-Encoding are inflated here. */
async function sitemapText(url: URL): Promise<string> {
  const response = await fetch(url.href)
  if (!response.ok) return ''
  const bytes = new Uint8Array(await response.arrayBuffer())
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!gzipped) return new TextDecoder().decode(bytes)
  const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(inflated).text()
}

function locations(xml: string, base: URL): { index: boolean; urls: URL[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const index = doc.documentElement.localName === 'sitemapindex'
  const urls = [...doc.getElementsByTagNameNS('*', 'loc')].flatMap(loc => {
    try {
      return [new URL(loc.textContent?.trim() ?? '', base)]
    } catch {
      return []
    }
  })
  return { index, urls }
}

async function readSitemap(url: URL, origin: string, depth: number): Promise<string[]> {
  const { index, urls } = locations(await sitemapText(url), url)
  if (!index) return urls.map(u => u.pathname)
  if (depth > 0) return []
  // a sitemap index lists sitemap files, not pages: follow them (same origin only)
  const children = urls.filter(u => u.origin === origin).slice(0, MAX_CHILD_SITEMAPS)
  const nested = await Promise.all(
    children.map(child => readSitemap(child, origin, depth + 1).catch(() => [])),
  )
  return nested.flat()
}

/** Pathnames listed in a same-origin sitemap or sitemap index (route inventory, plan D12). */
export function sitemapRoutes(doc: Document, location: string): Promise<string[]> {
  const url = new URL(location, doc.baseURI)
  const origin = doc.location.origin
  if (url.origin !== origin) return Promise.resolve([])
  let cached = sitemapCache.get(url.href)
  if (!cached) {
    cached = readSitemap(url, origin, 0)
      .then(paths => [...new Set(paths)])
      .catch(() => [])
    sitemapCache.set(url.href, cached)
  }
  return cached
}

export interface EnvironmentOptions {
  readonly version: string
  readonly exclude: (element: Element) => boolean
  readonly knownRoutes: readonly string[]
  readonly routeKey: (url: URL) => string
  readonly sitemap?: boolean | string | undefined
  readonly scanScripts?: boolean | undefined
  readonly warnings: readonly string[]
}

export async function collectEnvironment(
  doc: Document,
  state: CoverageState,
  options: EnvironmentOptions,
): Promise<ReportEnvironment> {
  const known = [...options.knownRoutes]
  if (options.sitemap) {
    const location = options.sitemap === true ? '/sitemap.xml' : options.sitemap
    for (const path of await sitemapRoutes(doc, location)) {
      known.push(options.routeKey(new URL(path, doc.location.origin)))
    }
  }
  const knownRoutes = [...new Set(known)]
  const { gzipRatios, groups } = await sheetFacts(doc, options.exclude)
  const hasUnused = [...state.selectors.values()].some(r => r.status === 'unused')
  return {
    version: options.version,
    knownRoutes,
    timings: stylesheetTimings(),
    gzipRatios,
    groups,
    jsReferences:
      options.scanScripts === false || !hasUnused ? null : await javascriptReferences(doc),
    atRules: atRuleFacts(doc, options.exclude, state),
    warnings: options.warnings,
  }
}
