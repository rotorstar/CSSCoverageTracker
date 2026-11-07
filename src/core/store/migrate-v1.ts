import { type CoverageState, createState, upsertRoute, upsertSelector } from '../engine/state'

/** v1 localStorage entry (read-only, for migration). */
export interface SelectorData {
  selector: string
  matched: boolean
  printOnly: boolean
  source: string
}

/** v1 localStorage document (read-only, for migration). */
export interface StorageData {
  selectors: Record<string, SelectorData>
  pages: string[]
  lastScan: number
}

function isSelectorData(value: unknown): value is SelectorData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.selector === 'string' &&
    typeof v.matched === 'boolean' &&
    typeof v.printOnly === 'boolean' &&
    typeof v.source === 'string'
  )
}

export function isV1Storage(value: unknown): value is StorageData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.selectors === 'object' &&
    v.selectors !== null &&
    Array.isArray(v.pages) &&
    v.pages.every(page => typeof page === 'string') &&
    Object.values(v.selectors).every(isSelectorData)
  )
}

/** Convert v1 localStorage data; `null` when the value is not valid v1 data. */
export function migrateV1(value: unknown): CoverageState | null {
  if (!isV1Storage(value)) return null
  const state = createState()
  for (const entry of Object.values(value.selectors)) {
    upsertSelector(state, {
      selector: entry.selector,
      context: '',
      status: entry.printOnly ? 'print' : entry.matched ? 'used' : 'unused',
      bytes: 0,
      sources: [entry.source],
      routes: [],
      stale: false,
    })
  }
  for (const page of value.pages) upsertRoute(state, { key: page, status: 'partial', visits: 1 })
  return state
}
