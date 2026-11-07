import { walkSheet } from './collect/walk-cssom'
import { classifySelector } from './match/matcher'
import type { AnalyzeOptions, MatchRoot, SelectorResult } from './types'

function defaultRoot(sheet: CSSStyleSheet): MatchRoot {
  const root = sheet.ownerNode?.getRootNode()
  return root instanceof ShadowRoot ? root : document
}

/** Classify every selector of a stylesheet against the current DOM. */
export function analyzeSheet(sheet: CSSStyleSheet, options: AnalyzeOptions = {}): SelectorResult[] {
  const context = { root: options.root ?? defaultRoot(sheet), exclude: options.exclude }
  return walkSheet(sheet, 'inline').map(({ selector, print }) => ({
    selector,
    status: classifySelector(selector, print, context),
  }))
}
