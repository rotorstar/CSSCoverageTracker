import { Engine } from './engine/engine'
import { type CoverageState, createState, mergeStates } from './engine/state'
import { waitUntilActive } from './observe/lifecycle'
import type { Report } from './report/types'
import { defaultRouteKey, matchRoutePattern } from './route/route-key'
import type { StateConfig } from './selector/normalize'
import { migrateV1 } from './store/migrate-v1'
import { type CoverageStore, memoryStore, openStore } from './store/store'

/** Marker attribute of the tool's own UI host; never counted as usage. */
export const UI_ATTRIBUTE = 'data-css-coverage-ui'

export interface TrackerOptions {
  /** IndexedDB key (and v1 localStorage key to migrate). @default 'css-coverage-tracker' */
  readonly storageKey?: string
  /** @default 'indexeddb' */
  readonly storage?: 'indexeddb' | 'memory'
  /** IndexedDB factory (tests, iframes). @default globalThis.indexedDB */
  readonly indexedDB?: IDBFactory
  /** Map a URL to a route key. @default id-like segments → `:id`, slugs with ids → `:slug` */
  readonly routeKey?: (url: URL) => string
  /**
   * Route patterns checked before `routeKey` (`/jobs/:slug`, `/docs/*`): a
   * matching path is keyed by its pattern. Plain strings, so they can be passed
   * where functions cannot (Playwright fixture, `__CSS_COVERAGE_CONFIG__`).
   */
  readonly routePatterns?: readonly string[]
  /** Routes the app has (coverage = visited ∩ known / known). */
  readonly knownRoutes?: readonly string[]
  /** Read known routes from a same-origin sitemap (`true` = `/sitemap.xml`). */
  readonly sitemap?: boolean | string
  /** State attributes/classes neutralized in stage 2. */
  readonly state?: StateConfig
  /** Elements that never count as usage (in addition to the tool UI). */
  readonly exclude?: (element: Element) => boolean
  /** Debounce for DOM-mutation re-checks. @default 250 */
  readonly debounceMs?: number
  /** `auto`: Navigation API / popstate; `manual`: call `notifyNavigation()`. @default 'auto' */
  readonly navigation?: 'auto' | 'manual'
  /** Mount the badge/report UI. @default true */
  readonly ui?: boolean
  /** Badge position. @default 'bottom-left' */
  readonly position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
  /** Run even in production builds. @default false */
  readonly force?: boolean
  /** Override build-mode detection. */
  readonly mode?: 'development' | 'production'
  /** One instance per document. @default true */
  readonly singleton?: boolean
  /** Fetch cross-origin stylesheets (CORS) to analyze them. @default false */
  readonly fetchCrossOrigin?: boolean
  /** Scan same-origin scripts for class names to rate deletion confidence. @default true */
  readonly scanScripts?: boolean
  /** Route coverage needed for "high" deletion confidence. @default 0.9 */
  readonly confidenceThreshold?: number
  /** Expose the instance as `window.__CSS_COVERAGE__` (Playwright fixture). @default false */
  readonly expose?: boolean
  /** Document to observe. @default document */
  readonly document?: Document
}

export interface CoverageTracker {
  readonly enabled: boolean
  readonly options: TrackerOptions
  readonly storageWarning: string | null
  start(): Promise<void>
  stop(): void
  /** Full pass for the current route. */
  scan(): Promise<void>
  /** Merge inventory/report options into a running (possibly shared) tracker. */
  configure(
    options: Pick<
      TrackerOptions,
      'knownRoutes' | 'routePatterns' | 'sitemap' | 'confidenceThreshold' | 'fetchCrossOrigin'
    >,
  ): void
  /** Route key for a path or URL, using `routePatterns`, then `routeKey` (ids → `:id`). */
  routeFor(path: string): string
  /** Tell the tracker about a client-side navigation (optionally with a route pattern). */
  notifyNavigation(route?: string): void
  /** Resolves when no pass or re-check is running. */
  idle(): Promise<void>
  /** Persist now (merging with other tabs). */
  flush(): Promise<void>
  getState(): CoverageState
  /** Public report v2 (bytes, routes, confidence, deletion data). */
  getReport(): Promise<Report>
  /** Main-thread time (busy) and wall time of the last full pass. */
  readonly lastPass: { route: string; items: number; busyMs: number; wallMs: number } | null
  /** Start a fresh audit (replaces "reset"). */
  newEpoch(): Promise<void>
  subscribe(listener: () => void): () => void
}

const REGISTRY = Symbol.for('css-coverage-tracker')
/** Longest a burst of DOM mutations can postpone a re-check. */
const MAX_MUTATION_WAIT_MS = 1000
/** Synchronous budget for classifying pending changes right before user input. */
const INPUT_FLUSH_MS = 30

function isProductionBuild(): boolean {
  try {
    return typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
  } catch {
    return false
  }
}

class Tracker implements CoverageTracker {
  readonly enabled: boolean
  private readonly doc: Document
  private readonly engine: Engine
  private readonly exclude: (element: Element) => boolean
  private store: CoverageStore = memoryStore()
  private readonly listeners = new Set<() => void>()
  private readonly disposers: Array<() => void> = []
  private starting: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private mutationTimer: ReturnType<typeof setTimeout> | null = null
  private mutated = { deep: new Set<Element>(), shallow: new Set<Element>() }
  private sheetsChanged = false
  /** First mutation of the current debounce window (0 = none pending). */
  private firstMutationAt = 0
  private mutationGeneration = 0
  private processedGeneration = 0
  private lastUrl = ''
  private channel: BroadcastChannel | null = null
  private stopped = false
  /** Pending cross-origin stylesheet fetches (part of "work in progress" for idle()). */
  private fetching: Promise<void> = Promise.resolve()

  options: TrackerOptions

  configure(
    options: Pick<
      TrackerOptions,
      'knownRoutes' | 'routePatterns' | 'sitemap' | 'confidenceThreshold' | 'fetchCrossOrigin'
    >,
  ): void {
    const knownRoutes = [
      ...new Set([...(this.options.knownRoutes ?? []), ...(options.knownRoutes ?? [])]),
    ]
    const routePatterns = [
      ...new Set([...(this.options.routePatterns ?? []), ...(options.routePatterns ?? [])]),
    ]
    this.options = { ...this.options, ...options, knownRoutes, routePatterns }
  }

  constructor(options: TrackerOptions) {
    this.options = options
    this.doc = options.document ?? document
    const mode = options.mode ?? (isProductionBuild() ? 'production' : 'development')
    this.enabled = options.force === true || mode !== 'production'
    const userExclude = options.exclude
    this.exclude = element =>
      element.closest(`[${UI_ATTRIBUTE}]`) !== null || (userExclude?.(element) ?? false)
    this.engine = new Engine({ doc: this.doc, state: options.state, exclude: this.exclude })
  }

  get storageWarning(): string | null {
    return this.store.warning
  }

  private get key(): string {
    return this.options.storageKey ?? 'css-coverage-tracker'
  }

  start(): Promise<void> {
    if (!this.enabled) return Promise.resolve()
    this.starting ??= this.boot()
    return this.starting
  }

  private async boot(): Promise<void> {
    await waitUntilActive(this.doc)
    if (this.stopped) return
    const store =
      this.options.storage === 'memory'
        ? memoryStore()
        : await openStore(this.options.indexedDB ?? globalThis.indexedDB, this.key)
    if (this.stopped) {
      store.close()
      return
    }
    this.store = store
    const loaded = await this.store.load()
    if (this.stopped) {
      this.store.close()
      return
    }
    this.engine.state = loaded ?? this.migrate() ?? createState()
    this.recordContext()
    this.observeDom()
    this.observeLifecycle()
    this.observeOtherTabs()
    if (this.options.ui !== false) {
      const { mountPanel } = await import('../ui/panel')
      // stopped while the panel chunk was loading (React StrictMode double effects)
      if (this.stopped) return
      const unmount = mountPanel(
        this,
        this.options.position ? { position: this.options.position } : {},
      )
      this.disposers.push(unmount)
    }
    if (this.options.navigation !== 'manual') {
      this.observeNavigation()
      this.notifyNavigation()
    }
  }

  private migrate(): CoverageState | null {
    try {
      const raw = globalThis.localStorage?.getItem(this.key)
      return raw ? migrateV1(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  private recordContext(): void {
    const view = this.doc.defaultView
    if (!view) return
    const scheme = view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const theme = this.doc.documentElement.classList.contains('dark') ? 'dark' : scheme
    this.engine.state.contexts.add(`${view.innerWidth}x${view.innerHeight} ${theme}`)
  }

  private routeKey(): string {
    return this.routeFor(this.doc.location.href)
  }

  routeFor(path: string): string {
    return this.keyFor(new URL(path, this.doc.location.href))
  }

  private keyFor(url: URL): string {
    const pattern = matchRoutePattern(url.pathname, this.options.routePatterns ?? [])
    if (pattern !== null) return pattern
    return this.options.routeKey ? this.options.routeKey(url) : defaultRouteKey(url)
  }

  notifyNavigation(route?: string): void {
    if (!this.enabled) return
    const key = route ?? this.routeKey()
    this.lastUrl = this.doc.location.href
    const isNewRoute = key !== this.engine.route
    if (!isNewRoute && this.engine.passRunning) return
    this.engine.route = key
    if (isNewRoute) {
      const visits = (this.engine.state.routes.get(key)?.visits ?? 0) + 1
      this.engine.state.routes.set(key, {
        key,
        status: this.engine.state.routes.get(key)?.status ?? 'pending',
        visits,
      })
    }
    this.recordContext()
    void this.engine.startPass(key).then(() => {
      this.changed()
      this.fetching = this.fetchCrossOriginSheets()
    })
  }

  async scan(): Promise<void> {
    if (!this.enabled) return
    await this.engine.startPass(this.engine.route || this.routeKey())
    this.changed()
  }

  async idle(): Promise<void> {
    // a start() nobody awaited (init scripts, adapters) is work in progress too:
    // until it has loaded the store and begun the first pass there is nothing to report
    if (this.starting) await this.starting
    // changes pending when idle() was called count as work in progress (later ones don't,
    // so a page that mutates forever cannot keep idle() from resolving)
    const target = this.mutationGeneration
    while (this.processedGeneration < target && !this.stopped) {
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(this.options.debounceMs ?? 250, 50)),
      )
    }
    await this.engine.idle()
    await this.fetching
    await this.engine.idle()
  }

  async flush(): Promise<void> {
    if (!this.enabled) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.engine.idle()
    if (this.stopped) return
    const saved = await this.store.save(this.engine.state)
    // merge instead of replace: work applied while the save was in flight must survive
    this.engine.state = mergeStates(saved, this.engine.state)
    this.channel?.postMessage('saved')
  }

  getState(): CoverageState {
    return this.engine.state
  }

  async getReport(): Promise<Report> {
    await this.idle()
    // report building is loaded on demand: the always-on core stays small
    const [{ buildReport }, { collectEnvironment }] = await Promise.all([
      import('./report/build'),
      import('./report/collect-environment'),
    ])
    const env = await collectEnvironment(this.doc, this.engine.state, {
      version: __CSS_COVERAGE_VERSION__,
      exclude: this.exclude,
      knownRoutes: this.options.knownRoutes ?? [],
      routeKey: url => this.keyFor(url),
      sitemap: this.options.sitemap,
      scanScripts: this.options.scanScripts,
      warnings: this.storageWarning ? [this.storageWarning] : [],
    })
    return buildReport(this.engine.state, {
      ...env,
      ...(this.options.confidenceThreshold === undefined
        ? {}
        : { confidenceThreshold: this.options.confidenceThreshold }),
    })
  }

  private async fetchCrossOriginSheets(): Promise<void> {
    if (!this.options.fetchCrossOrigin) return
    const pending = [...this.engine.state.sources.values()].filter(
      source => !source.readable && source.href !== null && !this.engine.hasFetched(source.key),
    )
    if (pending.length === 0) return
    let added = 0
    for (const source of pending) {
      try {
        const response = await fetch(source.href ?? '', { mode: 'cors', credentials: 'omit' })
        if (!response.ok) continue
        const sheet = new CSSStyleSheet()
        await sheet.replace(await response.text())
        this.engine.addFetchedSheet(source.key, sheet)
        added++
      } catch {
        /* no CORS: stays listed as unreadable */
      }
    }
    if (added > 0) await this.scan()
  }

  get lastPass(): CoverageTracker['lastPass'] {
    return this.engine.lastPass
  }

  async newEpoch(): Promise<void> {
    this.engine.abort()
    this.engine.state = createState(this.engine.state.epoch + 1)
    await this.flush()
    if (this.engine.route) await this.engine.startPass(this.engine.route)
    this.changed()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    if (this.stopped) return
    for (const listener of this.listeners) listener()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 300)
  }

  private observeDom(): void {
    const isSheetOwner = (node: Node | null): boolean =>
      node instanceof HTMLStyleElement ||
      (node instanceof HTMLLinkElement && /\bstylesheet\b/i.test(node.rel))
    const touchesSheets = (node: Node): boolean =>
      isSheetOwner(node) ||
      (node instanceof Element && node.querySelector('style, link[rel~="stylesheet" i]') !== null)
    const handle = (records: readonly MutationRecord[]): void => {
      for (const record of records) {
        if (record.type === 'childList') {
          if (isSheetOwner(record.target)) this.sheetsChanged = true // <style> text replaced (HMR)
          // the parent's own selectors may change too (`.stack > * + *`, `:empty`, `:has()`)
          if (record.target instanceof Element) this.mutated.shallow.add(record.target)
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element) this.mutated.deep.add(node)
            if (touchesSheets(node)) this.sheetsChanged = true
          }
          for (const node of Array.from(record.removedNodes))
            if (touchesSheets(node)) this.sheetsChanged = true
        } else if (record.type === 'characterData') {
          if (isSheetOwner(record.target.parentNode)) this.sheetsChanged = true
        } else if (record.target instanceof Element) {
          this.mutated.shallow.add(record.target)
          if (isSheetOwner(record.target)) this.sheetsChanged = true // href/media/disabled
        }
      }
    }
    const observer = new MutationObserver(records => {
      handle(records)
      this.scheduleMutations()
    })
    observer.observe(this.doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    // a <link> that finishes loading after start changes document.styleSheets
    const onLoad = (event: Event): void => {
      if (isSheetOwner(event.target instanceof Node ? event.target : null)) {
        this.sheetsChanged = true
        this.scheduleMutations()
      }
    }
    this.doc.addEventListener('load', onLoad, true)
    // The next interaction may end the visible state (outside click closes a popover):
    // classify pending changes synchronously before any app handler runs.
    const view = this.doc.defaultView
    const onInput = (): void => {
      const pending = observer.takeRecords() // not yet delivered to the callback
      if (pending.length > 0) handle(pending)
      if (this.mutationTimer === null && pending.length === 0) return
      if (this.mutationTimer !== null) clearTimeout(this.mutationTimer)
      this.processMutations(INPUT_FLUSH_MS)
    }
    view?.addEventListener('pointerdown', onInput, true)
    view?.addEventListener('keydown', onInput, true)
    this.disposers.push(() => {
      observer.disconnect()
      this.doc.removeEventListener('load', onLoad, true)
      view?.removeEventListener('pointerdown', onInput, true)
      view?.removeEventListener('keydown', onInput, true)
    })
  }

  private scheduleMutations(): void {
    this.mutationGeneration++
    if (this.mutationTimer) clearTimeout(this.mutationTimer)
    const now = performance.now()
    if (this.firstMutationAt === 0) this.firstMutationAt = now
    // max wait: constant DOM churn (animations, tickers) must not starve re-checks
    const remaining = Math.max(0, MAX_MUTATION_WAIT_MS - (now - this.firstMutationAt))
    this.mutationTimer = setTimeout(
      () => this.processMutations(),
      Math.min(this.options.debounceMs ?? 250, remaining),
    )
  }

  private processMutations(syncMs: number = 0): void {
    this.mutationTimer = null
    this.firstMutationAt = 0
    this.processedGeneration = this.mutationGeneration
    this.recordContext() // theme toggles (class="dark") are contexts too
    const { deep, shallow } = this.mutated
    this.mutated = { deep: new Set(), shallow: new Set() }
    const keep = (element: Element): boolean =>
      element.isConnected && element.closest(`[${UI_ATTRIBUTE}]`) === null
    if (this.sheetsChanged) {
      // stylesheets were added, removed or rewritten: full pass for the current route
      this.sheetsChanged = false
      if (this.engine.route) {
        void this.engine.startPass(this.engine.route).then(() => this.changed())
        return
      }
    }
    this.engine.observe([...deep].filter(keep), true, syncMs)
    this.engine.observe([...shallow].filter(keep), false, syncMs)
    if (this.options.navigation !== 'manual' && this.doc.location.href !== this.lastUrl) {
      this.notifyNavigation()
    }
    void this.engine.idle().then(() => this.changed())
  }

  private observeLifecycle(): void {
    const view = this.doc.defaultView
    if (!view) return
    const onHidden = (): void => {
      if (this.doc.visibilityState === 'hidden') void this.flush()
    }
    const onPageHide = (): void => void this.flush()
    const onPageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted) return
      const route = this.engine.state.routes.get(this.engine.route)
      if (route?.status !== 'complete') void this.engine.startPass(this.engine.route)
    }
    this.doc.addEventListener('visibilitychange', onHidden)
    view.addEventListener('pagehide', onPageHide)
    view.addEventListener('pageshow', onPageShow)
    this.disposers.push(() => {
      this.doc.removeEventListener('visibilitychange', onHidden)
      view.removeEventListener('pagehide', onPageHide)
      view.removeEventListener('pageshow', onPageShow)
    })
  }

  private observeNavigation(): void {
    const view = this.doc.defaultView
    if (!view) return
    const navigation: unknown = Reflect.get(view, 'navigation')
    if (navigation instanceof EventTarget) {
      // `navigate` fires before the URL commits (also for pushState): finish the outgoing route
      const onNavigate = (): void => this.engine.flushSync(30)
      const onEntry = (): void => this.notifyNavigation()
      navigation.addEventListener('navigate', onNavigate)
      navigation.addEventListener('currententrychange', onEntry)
      this.disposers.push(() => {
        navigation.removeEventListener('navigate', onNavigate)
        navigation.removeEventListener('currententrychange', onEntry)
      })
      return
    }
    const onChange = (): void => this.notifyNavigation()
    view.addEventListener('popstate', onChange)
    view.addEventListener('hashchange', onChange)
    this.disposers.push(() => {
      view.removeEventListener('popstate', onChange)
      view.removeEventListener('hashchange', onChange)
    })
  }

  private observeOtherTabs(): void {
    if (typeof BroadcastChannel === 'undefined' || this.store.kind !== 'indexeddb') return
    const channel = new BroadcastChannel(`css-coverage:${this.key}`)
    channel.onmessage = async () => {
      const other = await this.store.load()
      if (!other) return
      this.engine.state = mergeStates(this.engine.state, other)
      for (const listener of this.listeners) listener()
    }
    this.channel = channel
    this.disposers.push(() => channel.close())
  }

  stop(): void {
    this.stopped = true
    this.engine.abort()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.mutationTimer) clearTimeout(this.mutationTimer)
    for (const dispose of this.disposers.splice(0)) dispose()
    this.store.close()
    this.channel = null
    const registry: unknown = Reflect.get(globalThis, REGISTRY)
    if (registry === this) Reflect.deleteProperty(globalThis, REGISTRY)
    if (Reflect.get(globalThis, '__CSS_COVERAGE__') === this) {
      Reflect.deleteProperty(globalThis, '__CSS_COVERAGE__')
    }
  }
}

function isTracker(value: unknown): value is CoverageTracker {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getState' in value &&
    'notifyNavigation' in value &&
    typeof value.getState === 'function'
  )
}

/** The tracker already running in this document, if any (any copy of the package). */
export function getCoverageTracker(): CoverageTracker | null {
  const existing: unknown = Reflect.get(globalThis, REGISTRY)
  return isTracker(existing) ? existing : null
}

/**
 * Create (or reuse) the coverage tracker of this document. Adapters, the
 * `/auto` entry and the Playwright fixture share one instance.
 */
export function createCoverageTracker(options: TrackerOptions = {}): CoverageTracker {
  if (options.singleton !== false) {
    const existing: unknown = Reflect.get(globalThis, REGISTRY)
    // duck-typed: another copy of the package (e.g. Playwright's IIFE + the app bundle) shares it
    if (isTracker(existing)) return existing
  }
  const tracker = new Tracker(options)
  if (options.singleton !== false) Reflect.set(globalThis, REGISTRY, tracker)
  if (options.expose) Reflect.set(globalThis, '__CSS_COVERAGE__', tracker)
  return tracker
}
