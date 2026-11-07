import { splitSelectorList } from './split-list'
import { serializeTokens, skipBlock, skipString, type Token, tokenizeSelector } from './tokenize'

/** Attributes and classes that UI libraries toggle at runtime (plan A6). */
export interface StateConfig {
  /** Attribute names (lowercase) whose presence or value reflects a UI state. */
  readonly attributes: readonly string[]
  /** Class names toggled by JavaScript. */
  readonly classes: readonly string[]
  /** Class-name prefixes toggled by JavaScript (`is-active`, `has-error`). */
  readonly classPrefixes: readonly string[]
}

export const DEFAULT_STATE: StateConfig = {
  attributes: [
    // Radix / shadcn
    'data-state',
    'data-side',
    'data-align',
    'data-orientation',
    // Base UI (shadcn default since 2026-07)
    'data-open',
    'data-closed',
    'data-starting-style',
    'data-ending-style',
    'data-popup-open',
    'data-pressed',
    'data-instant',
    // React Aria
    'data-entering',
    'data-exiting',
    // generic
    'data-highlighted',
    'data-selected',
    'data-checked',
    'data-unchecked',
    'data-disabled',
    'data-active',
    'aria-expanded',
    'aria-selected',
    'aria-checked',
    'aria-pressed',
    'aria-current',
    'aria-invalid',
    'aria-disabled',
    'open',
    'hidden',
    'disabled',
    'inert',
  ],
  classes: [
    // Bootstrap JS
    'show',
    'showing',
    'hiding',
    'collapsing',
    'collapsed',
    'modal-open',
    'was-validated',
    'is-valid',
    'is-invalid',
    // generic
    'active',
    'open',
  ],
  classPrefixes: ['is-', 'has-'],
}

/** Pseudo-classes whose match does not depend on user interaction. */
const STABLE_PSEUDO_CLASSES = new Set([
  'root',
  'empty',
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'only-of-type',
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
  'scope',
  'lang',
  'dir',
  'link',
  'any-link',
])

/** `:host()`/`:host-context()`: argument normalized, bare form kept. */
const HOST_PSEUDO_CLASSES = new Set(['host', 'host-context'])

/** `:nth-child(An+B of S)`: S is normalized. */
const NTH_OF_PSEUDO_CLASSES = new Set(['nth-child', 'nth-last-child'])

/** Pseudo-classes that take a selector list and are evaluated recursively. */
const LOGICAL_PSEUDO_CLASSES = new Set(['is', 'where', 'has', 'matches', '-webkit-any', '-moz-any'])

const UNIVERSAL: Token = { kind: 'type', text: '*', name: '*' }

/**
 * Map every token; tokens mapped to `null` are removed. A compound that loses
 * all of its tokens becomes `*`, so combinators keep a left-hand side
 * (`.is-valid ~ .x` → `* ~ .x`), while relative selectors (`> .x`) stay relative.
 */
function rewriteTokens(tokens: readonly Token[], map: (token: Token) => Token | null): Token[] {
  const out: Token[] = []
  let compoundHadTokens = false
  let compoundKept = false
  const closeCompound = (): void => {
    if (compoundHadTokens && !compoundKept) out.push(UNIVERSAL)
    compoundHadTokens = false
    compoundKept = false
  }
  for (const token of tokens) {
    if (token.kind === 'combinator') {
      closeCompound()
      out.push(token)
      continue
    }
    compoundHadTokens = true
    const mapped = map(token)
    if (mapped) {
      out.push(mapped)
      compoundKept = true
    }
  }
  closeCompound()
  return out
}

function canonicalList(list: string): string {
  return splitSelectorList(list)
    .map(selector => serializeTokens(tokenizeSelector(selector)))
    .join(', ')
}

function isStateClass(name: string, state: StateConfig): boolean {
  return state.classes.includes(name) || state.classPrefixes.some(prefix => name.startsWith(prefix))
}

/**
 * Stage 1 of the status contract: remove only pseudo-elements, which never
 * match elements but do not change which element the rule styles.
 */
export function toRawMatchable(selector: string): string {
  return serializeTokens(rawTokens(tokenizeSelector(selector)))
}

/** Token form of {@link toRawMatchable}. */
export function rawTokens(tokens: readonly Token[]): Token[] {
  return rewriteTokens(tokens, t => (t.kind === 'pseudo-element' ? null : t))
}

function normalizeList(list: string, state: StateConfig): string {
  return splitSelectorList(list)
    .map(selector => normalizeState(selector, state))
    .join(', ')
}

/**
 * Stage 2 of the status contract: neutralize everything that depends on
 * runtime state (user-action pseudo-classes, state attributes, JS state
 * classes). The result matches a superset of the elements the input matches.
 */
export function normalizeState(selector: string, state: StateConfig = DEFAULT_STATE): string {
  return serializeTokens(normalizeTokens(tokenizeSelector(selector), state))
}

/** Token form of {@link normalizeState}. */
export function normalizeTokens(
  tokens: readonly Token[],
  state: StateConfig = DEFAULT_STATE,
): Token[] {
  return rewriteTokens(tokens, token => {
    if (token.kind === 'pseudo-element') return null
    if (token.kind === 'attribute' && state.attributes.includes(token.name)) return null
    if (token.kind === 'class' && isStateClass(token.name, state)) return null
    if (token.kind !== 'pseudo-class') return token
    const { argument } = token
    if (HOST_PSEUDO_CLASSES.has(token.name)) {
      return argument === undefined
        ? token
        : { ...token, text: `:${token.name}(${normalizeList(argument, state)})` }
    }
    if (argument !== undefined && NTH_OF_PSEUDO_CLASSES.has(token.name)) {
      const of = /^(.*?)\s+of\s+(.*)$/s.exec(argument)
      if (!of) return token
      return { ...token, text: `:${token.name}(${of[1]} of ${normalizeList(of[2] ?? '', state)})` }
    }
    if (argument !== undefined && LOGICAL_PSEUDO_CLASSES.has(token.name)) {
      return { ...token, text: `:${token.name}(${normalizeList(argument, state)})` }
    }
    if (argument !== undefined && token.name === 'not') {
      // keep a stateless :not(); drop it when it negates a state (broadens)
      return normalizeList(argument, state) === canonicalList(argument) ? token : null
    }
    return STABLE_PSEUDO_CLASSES.has(token.name) ? token : null
  })
}

/**
 * Resolve the nesting selector `&` against the parent's selector list
 * (`& .title` in `.card {}` → `:is(.card) .title`). Nested selectors without
 * `&` are relative to the parent (descendant).
 */
function replaceOutsideStrings(
  selector: string,
  replacement: string,
  matchAt: (selector: string, index: number) => number,
): { text: string; found: boolean } {
  let out = ''
  let found = false
  let i = 0
  while (i < selector.length) {
    const char = selector[i]
    let end = i + 1
    if (char === '\\') end = Math.min(i + 2, selector.length)
    else if (char === '"' || char === "'") end = skipString(selector, i)
    else if (char === '[') end = skipBlock(selector, i + 1, ']')
    else {
      const length = matchAt(selector, i)
      if (length > 0) {
        out += replacement
        found = true
        i += length
        continue
      }
    }
    out += selector.slice(i, end)
    i = end
  }
  return { text: out, found }
}

const matchNesting = (selector: string, i: number): number => (selector[i] === '&' ? 1 : 0)
const matchScope = (selector: string, i: number): number =>
  selector.startsWith(':scope', i) && !/[\w-]/.test(selector[i + 6] ?? '') ? 6 : 0

/**
 * Resolve the nesting selector `&` against the parent's selector list
 * (`& .title` in `.card {}` → `:is(.card) .title`). Nested selectors without
 * `&` are relative to the parent (descendant).
 */
export function resolveNesting(selector: string, parentList: string): string {
  const replacement = `:is(${parentList})`
  const { text, found } = replaceOutsideStrings(selector, replacement, matchNesting)
  return found ? text : `${replacement} ${selector}`
}

/**
 * Resolve a selector inside `@scope (<start>)`: `:scope` and `&` stand for the
 * scoping root; other selectors are its descendants. `to (…)` limits are
 * ignored (broadening, never narrowing).
 */
export function resolveScope(selector: string, scopeStart: string): string {
  const replacement = `:is(${scopeStart})`
  const scoped = replaceOutsideStrings(selector, replacement, matchScope)
  const nested = replaceOutsideStrings(scoped.text, replacement, matchNesting)
  return scoped.found || nested.found ? nested.text : `${replacement} ${selector}`
}
