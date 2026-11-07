/**
 * Coverage status of a single selector (plan §7, status contract):
 * - `used`: the selector as written matches at least one element
 * - `state-dependent`: only its state-normalized form matches (hover, open, …)
 * - `unused`: valid selector, nothing matches
 * - `print`: lives in a print-only context
 * - `unknown`: could not be evaluated safely (never reported as unused)
 */
export type SelectorStatus = 'used' | 'unused' | 'state-dependent' | 'print' | 'unknown'

export interface SelectorResult {
  /** Selector as serialized by the CSSOM (nested selectors resolved). */
  readonly selector: string
  readonly status: SelectorStatus
}

/** Tree that selectors are matched against. */
export type MatchRoot = Document | ShadowRoot

export interface AnalyzeOptions {
  /** Tree the selectors are matched against. @default document */
  readonly root?: MatchRoot
  /** Elements for which this returns true never make a selector used (e.g. the tool's own UI). */
  readonly exclude?: (element: Element) => boolean
}

/** A stylesheet together with the tree its rules apply to. */
export interface SheetEntry {
  readonly sheet: CSSStyleSheet
  readonly root: MatchRoot
}
