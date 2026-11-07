import type { SelectorStatus } from '../types'

export type RouteStatus = 'pending' | 'partial' | 'complete'

/** One selector in one context (`@media …`, `@layer …`), accumulated over all scans. */
export interface SelectorRecord {
  selector: string
  /** Enclosing at-rule path, e.g. `@media (min-width: 48rem) > @layer utilities`; '' at top level. */
  context: string
  status: SelectorStatus
  /** Serialized bytes of the rule, apportioned over the selectors of its list. */
  bytes: number
  /** Source keys (stylesheet URL without cache busters, `style:<id>`, …). */
  sources: string[]
  /** Routes on which the selector matched (used or state-dependent). */
  routes: string[]
  /** The rule disappeared from a source that is still loaded. */
  stale: boolean
}

export interface RouteRecord {
  key: string
  status: RouteStatus
  visits: number
}

export interface SourceRecord {
  key: string
  href: string | null
  kind: 'link' | 'style' | 'import' | 'adopted' | 'shadow' | 'fetched'
  media: string
  /** false for cross-origin sheets without CORS. */
  readable: boolean
  serializedBytes: number
  renderBlocking: boolean | null
  framework: 'tailwind' | null
}

export interface CoverageState {
  /** Audit epoch; a newer epoch replaces older data instead of merging with it. */
  epoch: number
  selectors: Map<string, SelectorRecord>
  routes: Map<string, RouteRecord>
  sources: Map<string, SourceRecord>
  /** Observed contexts, e.g. `1280x720 dark`. */
  contexts: Set<string>
}

const STATUS_RANK: Record<SelectorStatus, number> = {
  unused: 0,
  unknown: 1,
  'state-dependent': 2,
  used: 3,
  print: 4,
}
const STATUS_BY_CODE: readonly SelectorStatus[] = [
  'unused',
  'unknown',
  'state-dependent',
  'used',
  'print',
]
const STALE_FLAG = 8
const ROUTE_RANK: Record<RouteStatus, number> = { pending: 0, partial: 1, complete: 2 }

export function selectorKey(context: string, selector: string): string {
  return `${context}\u0000${selector}`
}

/** Monotonic: `unused < unknown < state-dependent < used`; `print` is decided by context. */
export function mergeStatus(a: SelectorStatus, b: SelectorStatus): SelectorStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
}

export function mergeRouteStatus(a: RouteStatus, b: RouteStatus): RouteStatus {
  return ROUTE_RANK[a] >= ROUTE_RANK[b] ? a : b
}

export function createState(epoch: number = 1): CoverageState {
  return { epoch, selectors: new Map(), routes: new Map(), sources: new Map(), contexts: new Set() }
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

export function upsertSelector(state: CoverageState, record: SelectorRecord): SelectorRecord {
  const key = selectorKey(record.context, record.selector)
  const existing = state.selectors.get(key)
  const merged: SelectorRecord = existing
    ? {
        selector: record.selector,
        context: record.context,
        status: mergeStatus(existing.status, record.status),
        bytes: Math.max(existing.bytes, record.bytes),
        sources: union(existing.sources, record.sources),
        routes: union(existing.routes, record.routes),
        stale: record.stale, // the newer observation decides
      }
    : { ...record, sources: [...record.sources], routes: [...record.routes] }
  state.selectors.set(key, merged)
  return merged
}

export function upsertRoute(state: CoverageState, route: RouteRecord): void {
  const existing = state.routes.get(route.key)
  state.routes.set(
    route.key,
    existing
      ? {
          key: route.key,
          status: mergeRouteStatus(existing.status, route.status),
          visits: Math.max(existing.visits, route.visits),
        }
      : { ...route },
  )
}

export function cloneState(state: CoverageState): CoverageState {
  const clone = createState(state.epoch)
  for (const record of state.selectors.values()) upsertSelector(clone, record)
  for (const route of state.routes.values()) upsertRoute(clone, route)
  for (const source of state.sources.values()) clone.sources.set(source.key, { ...source })
  for (const context of state.contexts) clone.contexts.add(context)
  return clone
}

/** Union of two states of the same epoch (tabs, devs, test runs); a newer epoch wins. */
export function mergeStates(a: CoverageState, b: CoverageState): CoverageState {
  if (a.epoch !== b.epoch) return cloneState(a.epoch > b.epoch ? a : b)
  const merged = cloneState(a)
  for (const record of b.selectors.values()) upsertSelector(merged, record)
  for (const route of b.routes.values()) upsertRoute(merged, route)
  for (const source of b.sources.values()) merged.sources.set(source.key, { ...source })
  for (const context of b.contexts) merged.contexts.add(context)
  return merged
}

/** Compact, interned form for IndexedDB and state exchange. */
export interface PersistedState {
  v: 2
  epoch: number
  sourceKeys: string[]
  routeKeys: string[]
  sources: SourceRecord[]
  routes: RouteRecord[]
  contexts: string[]
  /** Interned at-rule context paths of the selectors. */
  contextPaths: string[]
  /** [selector, contextPathIndex, statusCode (+8 when stale), bytes, sourceIndexes, routeIndexes] */
  selectors: Array<[string, number, number, number, number[], number[]]>
}

function interner(): { table: string[]; index: (value: string) => number } {
  const table: string[] = []
  const positions = new Map<string, number>()
  return {
    table,
    index: value => {
      const known = positions.get(value)
      if (known !== undefined) return known
      positions.set(value, table.length)
      table.push(value)
      return table.length - 1
    },
  }
}

export function toPersisted(state: CoverageState): PersistedState {
  const sourceKeys = interner()
  const routeKeys = interner()
  const contextPaths = interner()
  const selectors: PersistedState['selectors'] = []
  for (const r of state.selectors.values()) {
    selectors.push([
      r.selector,
      contextPaths.index(r.context),
      STATUS_RANK[r.status] + (r.stale ? STALE_FLAG : 0),
      r.bytes,
      r.sources.map(sourceKeys.index),
      r.routes.map(routeKeys.index),
    ])
  }
  return {
    v: 2,
    epoch: state.epoch,
    sourceKeys: sourceKeys.table,
    routeKeys: routeKeys.table,
    sources: [...state.sources.values()],
    routes: [...state.routes.values()],
    contexts: [...state.contexts],
    contextPaths: contextPaths.table,
    selectors,
  }
}

export function fromPersisted(persisted: PersistedState): CoverageState {
  const state = createState(persisted.epoch)
  const lookup = (table: readonly string[]) => (i: number) => table[i] ?? ''
  for (const [selector, contextIndex, code, bytes, sources, routes] of persisted.selectors) {
    const context = persisted.contextPaths[contextIndex] ?? ''
    state.selectors.set(selectorKey(context, selector), {
      selector,
      context,
      status: STATUS_BY_CODE[code & 7] ?? 'unknown',
      bytes,
      sources: sources.map(lookup(persisted.sourceKeys)),
      routes: routes.map(lookup(persisted.routeKeys)),
      stale: (code & STALE_FLAG) !== 0,
    })
  }
  for (const route of persisted.routes) state.routes.set(route.key, { ...route })
  for (const source of persisted.sources) state.sources.set(source.key, { ...source })
  for (const context of persisted.contexts) state.contexts.add(context)
  return state
}

/** Runtime guard for data read back from IndexedDB or another tab. */
export function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.v === 2 &&
    typeof v.epoch === 'number' &&
    Array.isArray(v.selectors) &&
    Array.isArray(v.sourceKeys) &&
    Array.isArray(v.routeKeys) &&
    Array.isArray(v.routes) &&
    Array.isArray(v.sources) &&
    Array.isArray(v.contexts) &&
    Array.isArray(v.contextPaths)
  )
}
