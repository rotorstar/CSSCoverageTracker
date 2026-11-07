import { sourceKey, sourceKind } from '../collect/source-key'
import { collectSheets, ownBytes, walkSheet } from '../collect/walk-cssom'
import { DomIndex } from '../match/dom-index'
import { classifyPrepared, type MatchContext } from '../match/matcher'
import { type PreparedSelector, prepareSelector } from '../match/prepare'
import type { StateConfig } from '../selector/normalize'
import type { MatchRoot, SelectorStatus } from '../types'
import { SlicedRun } from './scheduler'
import {
  type CoverageState,
  createState,
  mergeStatus,
  type RouteStatus,
  selectorKey,
  upsertRoute,
} from './state'

export interface ScanItem {
  readonly key: string
  readonly selector: string
  readonly context: string
  readonly print: boolean
  readonly bytes: number
  readonly source: string
  readonly root: MatchRoot
  readonly prepared: PreparedSelector
  readonly rule: CSSStyleRule
  readonly share: number
}

export interface EngineOptions {
  readonly doc: Document
  readonly state?: StateConfig | undefined
  readonly exclude?: ((element: Element) => boolean) | undefined
  /** Time slice per task in ms. @default 8 */
  readonly budgetMs?: number | undefined
}

/**
 * The scan engine: full passes per (route × epoch), incremental re-checks after
 * DOM mutations, stale detection. Pure in-memory; persistence lives in the tracker.
 */
export class Engine {
  state: CoverageState = createState()
  route = ''
  private items = new Map<string, ScanItem>()
  private byToken = new Map<string, Set<string>>()
  private indexes = new Map<MatchRoot, DomIndex>()
  private run: SlicedRun<ScanItem> | null = null
  private passPromise: Promise<unknown> = Promise.resolve()
  private incrementalPromise: Promise<unknown> = Promise.resolve()
  private measurePromise: Promise<unknown> = Promise.resolve()
  private readonly pending = new Set<string>()

  constructor(private readonly options: EngineOptions) {}

  get passRunning(): boolean {
    return this.run !== null
  }

  private index(root: MatchRoot): DomIndex {
    let index = this.indexes.get(root)
    if (!index) {
      index = DomIndex.build(root, this.options.exclude)
      this.indexes.set(root, index)
    }
    return index
  }

  /** Walk results per sheet; reused while the sheet object and its rule count are unchanged. */
  private readonly walkCache = new WeakMap<
    CSSStyleSheet,
    { signature: string; key: string; root: MatchRoot; items: ScanItem[] }
  >()
  private itemsVersion = ''
  /** Cross-origin sheets fetched with CORS and parsed into constructed sheets (plan C5). */
  private readonly fetched = new Map<string, CSSStyleSheet>()

  addFetchedSheet(key: string, sheet: CSSStyleSheet): void {
    this.fetched.set(key, sheet)
  }

  hasFetched(key: string): boolean {
    return this.fetched.has(key)
  }

  private signature(sheet: CSSStyleSheet): string {
    const rules = sheet.cssRules
    const last = rules[rules.length - 1]
    return `${rules.length}|${rules[0]?.cssText.length ?? 0}|${last?.cssText.length ?? 0}`
  }

  private collect(): { items: ScanItem[]; loaded: Set<string>; version: string } {
    const items: ScanItem[] = []
    const loaded = new Set<string>()
    const versions: string[] = []
    collectSheets(this.options.doc, this.options.exclude).forEach(({ sheet, root }, position) => {
      const key = sourceKey(sheet, position)
      let signature: string | null
      try {
        signature = this.signature(sheet)
      } catch {
        signature = null // cross-origin sheet without CORS
      }
      const previous = this.state.sources.get(key)
      this.state.sources.set(key, {
        key,
        href: sheet.href,
        kind: sourceKind(sheet, root instanceof ShadowRoot),
        media: sheet.media.mediaText,
        readable: signature !== null,
        serializedBytes: previous?.serializedBytes ?? 0,
        renderBlocking: previous?.renderBlocking ?? null,
        framework: previous?.framework ?? null,
      })
      if (signature === null) return
      loaded.add(key)
      let cached = this.walkCache.get(sheet)
      if (!cached || cached.signature !== signature || cached.key !== key || cached.root !== root) {
        cached = { signature, key, root, items: this.walkItems(sheet, key, root) }
        this.walkCache.set(sheet, cached)
      }
      versions.push(`${key}#${signature}#${cached.items.length}`)
      for (const item of cached.items) {
        loaded.add(item.source)
        items.push(item)
      }
    })
    for (const [key, sheet] of this.fetched) {
      const previous = this.state.sources.get(key)
      if (!previous || previous.readable) continue
      this.state.sources.set(key, { ...previous, kind: 'fetched', readable: true })
      loaded.add(key)
      let cached = this.walkCache.get(sheet)
      if (!cached) {
        cached = {
          signature: 'fetched',
          key,
          root: this.options.doc,
          items: this.walkItems(sheet, key, this.options.doc),
        }
        this.walkCache.set(sheet, cached)
      }
      versions.push(`${key}#fetched#${cached.items.length}`)
      items.push(...cached.items)
    }
    return { items, loaded, version: versions.join('\n') }
  }

  private walkItems(sheet: CSSStyleSheet, key: string, root: MatchRoot): ScanItem[] {
    return walkSheet(sheet, key, false).map(w => ({
      key: selectorKey(w.context, w.selector),
      selector: w.selector,
      context: w.context,
      print: w.print,
      bytes: 0,
      source: w.source === sheet.href || w.source === key ? key : w.source,
      root,
      prepared: prepareSelector(w.selector, this.options.state),
      rule: w.rule,
      share: w.share,
    }))
  }

  private readonly contexts = new Map<MatchRoot, MatchContext>()

  private classify(item: ScanItem): SelectorStatus {
    let context = this.contexts.get(item.root)
    if (!context) {
      context = {
        root: item.root,
        exclude: this.options.exclude,
        state: this.options.state,
        index: this.index(item.root),
      }
      this.contexts.set(item.root, context)
    }
    return classifyPrepared(item.prepared, item.print, context)
  }

  private apply(item: ScanItem, route: string): void {
    const existing = this.state.selectors.get(item.key)
    if (
      existing &&
      !existing.stale &&
      existing.status === 'used' &&
      existing.routes.includes(route)
    ) {
      if (!existing.sources.includes(item.source)) existing.sources.push(item.source)
      return
    }
    const status = this.classify(item)
    const matched = (status === 'used' || status === 'state-dependent') && route !== ''
    if (!existing) {
      this.state.selectors.set(item.key, {
        selector: item.selector,
        context: item.context,
        status,
        bytes: 0,
        sources: [item.source],
        routes: matched ? [route] : [],
        stale: false,
      })
      return
    }
    existing.status = mergeStatus(existing.status, status)
    existing.stale = false
    if (matched && !existing.routes.includes(route)) existing.routes.push(route)
    if (!existing.sources.includes(item.source)) existing.sources.push(item.source)
  }

  private markStale(items: readonly ScanItem[], loaded: ReadonlySet<string>): void {
    const seen = new Set(items.map(item => item.key))
    for (const [key, record] of this.state.selectors) {
      if (seen.has(key)) continue
      if (record.sources.length > 0 && record.sources.every(source => loaded.has(source))) {
        record.stale = true
      }
    }
  }

  /** Full pass for `route`; aborts a running pass (which stays `partial`). */
  startPass(route: string): Promise<RouteStatus> {
    this.run?.abort()
    this.indexes.clear()
    this.contexts.clear()
    const started = performance.now()
    const { items, loaded, version } = this.collect()
    if (version !== this.itemsVersion) this.rebuildTokenIndex(items, version)
    const collectMs = performance.now() - started
    this.startRun(items, loaded, route, started, collectMs)
    return this.passPromiseTyped
  }

  /** Statistics of the last finished pass (debugging, benchmarks). */
  lastPass: { route: string; items: number; busyMs: number; wallMs: number } | null = null

  private passPromiseTyped: Promise<RouteStatus> = Promise.resolve('complete')

  private rebuildTokenIndex(items: readonly ScanItem[], version: string): void {
    this.itemsVersion = version
    this.items = new Map(items.map(item => [item.key, item]))
    this.byToken.clear()
    for (const item of items) {
      for (const token of item.prepared.tokenStrings) {
        let keys = this.byToken.get(token)
        if (!keys) {
          keys = new Set()
          this.byToken.set(token, keys)
        }
        keys.add(item.key)
      }
    }
  }

  private startRun(
    items: readonly ScanItem[],
    loaded: ReadonlySet<string>,
    route: string,
    started: number,
    collectMs: number,
  ): void {
    upsertRoute(this.state, { key: route, status: 'partial', visits: 0 })
    const run = new SlicedRun(items, item => this.apply(item, route))
    this.run = run
    const result = run.run(this.options.budgetMs ?? 8).then((completed): RouteStatus => {
      if (this.run === run) this.run = null
      this.lastPass = {
        route,
        items: items.length,
        busyMs: collectMs + run.busyMs,
        wallMs: performance.now() - started,
      }
      if (!completed) return 'partial'
      this.markStale(items, loaded)
      upsertRoute(this.state, { key: route, status: 'complete', visits: 0 })
      this.measurePromise = this.measure(items)
      return 'complete'
    })
    this.passPromise = result
    this.passPromiseTyped = result
  }

  /**
   * Byte accounting after the scan (costly `cssText` serialization), time-sliced
   * and only for selectors not measured yet.
   */
  /** Rule sizes survive passes: rule objects are stable while their sheet is unchanged. */
  private readonly ruleBytes = new WeakMap<CSSStyleRule, number>()

  private async measure(items: readonly ScanItem[]): Promise<void> {
    const totals = new Map<string, number>()
    await new SlicedRun(items, item => {
      let bytes = this.ruleBytes.get(item.rule)
      if (bytes === undefined) {
        bytes = ownBytes(item.rule)
        this.ruleBytes.set(item.rule, bytes)
      }
      const share = Math.round(bytes / item.share)
      totals.set(item.source, (totals.get(item.source) ?? 0) + share)
      const record = this.state.selectors.get(item.key)
      if (record && record.bytes === 0) record.bytes = share
    }).run(this.options.budgetMs ?? 8)
    for (const [key, bytes] of totals) {
      const source = this.state.sources.get(key)
      if (source) source.serializedBytes = Math.round(bytes)
    }
  }

  /** Synchronously process as much of the running pass as fits into `ms` (navigation flush). */
  flushSync(ms: number): void {
    this.run?.drainSync(performance.now() + ms)
  }

  /** Learn the tokens of new/changed elements and re-check the selectors that use them. */
  observe(elements: readonly Element[], deep: boolean, syncMs: number = 0): void {
    const index = this.index(this.options.doc)
    for (const element of elements) {
      const tokens = deep ? index.add(element) : index.addOne(element)
      for (const token of tokens) {
        for (const key of this.byToken.get(token) ?? []) this.pending.add(key)
      }
    }
    if (this.pending.size === 0) return
    const items = [...this.pending]
      .map(key => this.items.get(key))
      .filter((item): item is ScanItem => item !== undefined)
    this.pending.clear()
    const route = this.route
    const run = new SlicedRun(items, item => this.apply(item, route))
    // synchronous head start: classify against the DOM as it is right now
    if (syncMs > 0) run.drainSync(performance.now() + syncMs)
    this.incrementalPromise = this.incrementalPromise.then(() =>
      run.run(this.options.budgetMs ?? 8),
    )
  }

  async idle(): Promise<void> {
    let pass: Promise<unknown>
    let incremental: Promise<unknown>
    let measure: Promise<unknown>
    do {
      pass = this.passPromise
      incremental = this.incrementalPromise
      await Promise.all([pass, incremental])
      measure = this.measurePromise
      await measure
    } while (
      pass !== this.passPromise ||
      incremental !== this.incrementalPromise ||
      measure !== this.measurePromise
    )
  }

  abort(): void {
    this.run?.abort()
    this.run = null
  }
}
