import type { StateConfig } from '../selector/normalize'
import { serializeTokens, type Token, tokenizeSelector } from '../selector/tokenize'
import type { MatchRoot, SelectorStatus } from '../types'
import type { DomIndex } from './dom-index'
import { type PreparedSelector, prepareSelector } from './prepare'

export interface MatchContext {
  readonly root: MatchRoot
  readonly exclude?: ((element: Element) => boolean) | undefined
  readonly state?: StateConfig | undefined
  /** Token index of `root`; lets selectors with missing tokens skip the DOM query. */
  readonly index?: DomIndex | undefined
}

function anyIncluded(elements: Iterable<Element>, exclude: MatchContext['exclude']): boolean {
  for (const element of elements) {
    if (!exclude?.(element)) return true
  }
  return false
}

function matchesInTree(selector: string, { root, exclude }: MatchContext): boolean {
  const first = root.querySelector(selector)
  if (first === null) return false
  if (!exclude?.(first)) return true
  return anyIncluded(root.querySelectorAll(selector), exclude)
}

const HOST_PSEUDOS = new Set(['host', 'host-context'])

/** `:host`, `:host(X)` and `:host-context(X)` match the shadow host, not a shadow-tree element. */
function hostMatches(token: Token, host: Element): boolean {
  if (token.argument === undefined) return true
  if (token.name === 'host') return host.matches(token.argument)
  // :host-context() checks the host and its ancestors across shadow boundaries
  let element: Element | null = host
  while (element) {
    if (element.matches(token.argument)) return true
    const parent: Element | null = element.parentElement
    if (parent) element = parent
    else {
      const root = element.getRootNode()
      element = root instanceof ShadowRoot ? root.host : null
    }
  }
  return false
}

function matchesShadowHostSelector(tokens: readonly Token[], shadow: ShadowRoot): boolean {
  const combinatorIndex = tokens.findIndex(t => t.kind === 'combinator')
  const hostCompound = combinatorIndex === -1 ? tokens : tokens.slice(0, combinatorIndex)
  for (const token of hostCompound) {
    const ok =
      token.kind === 'pseudo-class' && HOST_PSEUDOS.has(token.name)
        ? hostMatches(token, shadow.host)
        : shadow.host.matches(token.text)
    if (!ok) return false
  }
  if (combinatorIndex === -1) return true

  const combinator = tokens[combinatorIndex]?.text
  const restTokens = tokens.slice(combinatorIndex + 1)
  if (combinator === ' ') return shadow.querySelector(serializeTokens(restTokens)) !== null
  if (combinator !== '>') return false // the host has no siblings inside its own shadow tree

  // `:host > A …`: A must be a direct child of the shadow root
  const next = restTokens.findIndex(t => t.kind === 'combinator')
  const firstCompound = serializeTokens(next === -1 ? restTokens : restTokens.slice(0, next))
  const remainder = next === -1 ? '' : serializeTokens(restTokens.slice(next))
  const nextCombinator = restTokens[next]?.text
  return Array.from(shadow.children).some(child => {
    if (!child.matches(firstCompound)) return false
    if (remainder === '') return true
    if (nextCombinator === ' ' || nextCombinator === '>') {
      return child.querySelector(`:scope ${remainder}`) !== null
    }
    return shadow.querySelector(serializeTokens(restTokens)) !== null // + / ~: broaden
  })
}

/** Does the selector match at least one (non-excluded) element of the context? Throws if invalid. */
export function selectorMatches(selector: string, context: MatchContext): boolean {
  const { root } = context
  if (root instanceof ShadowRoot) {
    const tokens = tokenizeSelector(selector)
    const first = tokens[0]
    if (first?.kind === 'pseudo-class' && HOST_PSEUDOS.has(first.name)) {
      return matchesShadowHostSelector(tokens, root)
    }
  }
  return matchesInTree(selector, context)
}

/**
 * Two-stage status contract (plan §7):
 * stage 1 — selector as written (pseudo-elements removed) matches → used;
 * stage 2 — state-normalized selector matches → state-dependent;
 * otherwise unused. Anything that cannot be evaluated → unknown, never unused.
 */
export function classifySelector(
  selector: string,
  print: boolean,
  context: MatchContext,
): SelectorStatus {
  return classifyPrepared(prepareSelector(selector, context.state), print, context)
}

export function classifyPrepared(
  prepared: PreparedSelector,
  print: boolean,
  context: MatchContext,
): SelectorStatus {
  if (print) return 'print'
  const { raw, normalized, rawTokens, normalizedTokens } = prepared
  if (raw === null || normalized === null) return 'unknown'
  const { index } = context
  try {
    const rawPossible = !index || rawTokens === null || index.has(rawTokens)
    if (rawPossible && selectorMatches(raw, context)) return 'used'
    const normalizedPossible = !index || normalizedTokens === null || index.has(normalizedTokens)
    if (normalized !== raw && normalizedPossible && selectorMatches(normalized, context)) {
      return 'state-dependent'
    }
    return 'unused'
  } catch {
    return 'unknown'
  }
}
