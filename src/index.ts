export { analyzeSheet } from './core/analyze'
export {
  type CoverageTracker,
  createCoverageTracker,
  getCoverageTracker,
  type TrackerOptions,
  UI_ATTRIBUTE,
} from './core/api'
export { collectSheets } from './core/collect/walk-cssom'
export type {
  CoverageState,
  RouteRecord,
  RouteStatus,
  SelectorRecord,
  SourceRecord,
} from './core/engine/state'
export type { Confidence, Report, ReportSelector, ReportSource } from './core/report/types'
export { defaultRouteKey, routePattern } from './core/route/route-key'
export { DEFAULT_STATE, type StateConfig } from './core/selector/normalize'
export type {
  AnalyzeOptions,
  MatchRoot,
  SelectorResult,
  SelectorStatus,
  SheetEntry,
} from './core/types'
