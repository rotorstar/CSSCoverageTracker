import { resolveNesting, resolveScope } from '../selector/normalize'
import { splitSelectorList } from '../selector/split-list'
import type { MatchRoot, SheetEntry } from '../types'
import { isPrintOnly } from './media'

/** One selector of a style rule, with nesting/scope already resolved. */
export interface WalkedSelector {
  readonly selector: string
  readonly print: boolean
  readonly source: string
  /** Enclosing at-rules, e.g. `@media (min-width: 48rem) > @layer utilities`; '' at top level. */
  readonly context: string
  /** Serialized UTF-8 bytes of the rule, apportioned over the selectors of its list (0 when not measured). */
  readonly bytes: number
  /** The style rule, for deferred byte measurement. */
  readonly rule: CSSStyleRule
  /** Number of selectors in the rule's list. */
  readonly share: number
}

interface WalkContext {
  readonly source: string
  readonly print: boolean
  /** Resolved selector list of the enclosing style rule (CSS nesting). */
  readonly parent?: string | undefined
  /** Scoping root selector of an enclosing `@scope`. */
  readonly scope?: string | undefined
  /** Enclosing at-rule path. */
  readonly path: string
  /** Measure bytes while walking (costly `cssText` serialization). */
  readonly measure: boolean
}

const encoder = new TextEncoder()

/** Bytes of the rule itself (selector + declarations), without nested child rules. */
export function ownBytes(rule: CSSStyleRule): number {
  return encoder.encode(`${rule.selectorText}{${rule.style.cssText}}`).length
}

function atRuleLabel(rule: CSSRule): string | null {
  if (rule instanceof CSSMediaRule) return `@media ${rule.media.mediaText}`
  if (rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`
  if (rule instanceof CSSLayerBlockRule) return `@layer ${rule.name}`
  if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
    return `@container ${rule.conditionText}`
  }
  if (typeof CSSScopeRule !== 'undefined' && rule instanceof CSSScopeRule) {
    return `@scope (${rule.start ?? ''})`
  }
  if (typeof CSSStartingStyleRule !== 'undefined' && rule instanceof CSSStartingStyleRule) {
    return '@starting-style'
  }
  return null
}

const join = (path: string, label: string | null): string =>
  label === null ? path : path === '' ? label : `${path} > ${label}`

function resolveSelectors(selectorText: string, context: WalkContext): string[] {
  const selectors = splitSelectorList(selectorText)
  const { parent, scope } = context
  if (parent !== undefined) return selectors.map(s => resolveNesting(s, parent))
  if (scope !== undefined) return selectors.map(s => resolveScope(s, scope))
  return selectors
}

function readRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules
  } catch {
    return null // cross-origin sheet without CORS
  }
}

function walk(ruleList: CSSRuleList, context: WalkContext, out: WalkedSelector[]): void {
  for (const rule of Array.from(ruleList)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = resolveSelectors(rule.selectorText, context)
      const share = Math.max(selectors.length, 1)
      const bytes = context.measure ? ownBytes(rule) / share : 0
      for (const selector of selectors) {
        out.push({
          selector,
          print: context.print,
          source: context.source,
          context: context.path,
          bytes,
          rule,
          share,
        })
      }
      if (rule.cssRules.length > 0) {
        walk(rule.cssRules, { ...context, parent: selectors.join(', '), scope: undefined }, out)
      }
    } else if (rule instanceof CSSImportRule) {
      const imported = rule.styleSheet ? readRules(rule.styleSheet) : null
      if (imported) {
        const print = context.print || isPrintOnly(rule.media.mediaText)
        walk(
          imported,
          { source: rule.href, print, path: context.path, measure: context.measure },
          out,
        )
      }
    } else if (rule instanceof CSSMediaRule) {
      walk(
        rule.cssRules,
        { ...context, print: context.print || isPrintOnly(rule.media.mediaText) },
        out,
      )
    } else if (typeof CSSScopeRule !== 'undefined' && rule instanceof CSSScopeRule) {
      // no prelude: the scoping root is the owner element's parent → broaden to `*`
      const start = rule.start ?? '*'
      const { parent } = context
      const resolvedStart = parent === undefined ? start : resolveNesting(start, parent)
      walk(
        rule.cssRules,
        {
          ...context,
          scope: resolvedStart,
          parent: undefined,
          path: join(context.path, atRuleLabel(rule)),
        },
        out,
      )
    } else if (rule instanceof CSSKeyframesRule) {
      // keyframe selectors (0%, to) are not element selectors
    } else if (rule instanceof CSSGroupingRule) {
      // @layer, @supports, @container, @starting-style, …
      walk(rule.cssRules, { ...context, path: join(context.path, atRuleLabel(rule)) }, out)
    }
  }
}

/** Every selector of a stylesheet, including nested, scoped and @import-ed rules. */
export function walkSheet(
  sheet: CSSStyleSheet,
  fallbackSource: string,
  measure: boolean = true,
): WalkedSelector[] {
  const rules = readRules(sheet)
  if (!rules) return []
  const out: WalkedSelector[] = []
  walk(
    rules,
    {
      source: sheet.href ?? fallbackSource,
      print: isPrintOnly(sheet.media.mediaText),
      path: '',
      measure,
    },
    out,
  )
  return out
}

/** Stylesheet href or `"inline-<index>"` for inline `<style>` blocks. */
export function sheetSource(sheet: CSSStyleSheet, index: number): string {
  return sheet.href || `inline-${index}`
}

/**
 * Every stylesheet the tracker scans, with the tree its rules apply to:
 * document sheets, adopted sheets and the sheets of open shadow roots.
 * One entry per (sheet, root): a sheet shared by several shadow roots (Lit)
 * is matched against each of them. Duplicates of the same pair are dropped
 * (Safari < 27 also lists adopted sheets in `document.styleSheets`).
 */
export function collectSheets(
  doc: Document,
  exclude?: (element: Element) => boolean,
): SheetEntry[] {
  const seen = new Map<CSSStyleSheet, Set<MatchRoot>>()
  const entries: SheetEntry[] = []
  const add = (sheet: CSSStyleSheet, root: MatchRoot): void => {
    const roots = seen.get(sheet) ?? new Set<MatchRoot>()
    if (roots.has(root)) return
    roots.add(root)
    seen.set(sheet, roots)
    entries.push({ sheet, root })
  }
  const visit = (root: MatchRoot): void => {
    for (const sheet of Array.from(root.styleSheets)) add(sheet, root)
    for (const sheet of root.adoptedStyleSheets) add(sheet, root)
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.shadowRoot && !exclude?.(element)) visit(element.shadowRoot)
    }
  }
  visit(doc)
  return entries
}
