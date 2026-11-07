import { DEFAULT_STATE, normalizeTokens, rawTokens, type StateConfig } from '../selector/normalize'
import { type RequiredTokens, requiredTokensOf } from '../selector/required-tokens'
import { serializeTokens, tokenizeSelector } from '../selector/tokenize'

/** Everything the matcher needs about a selector, computed from ONE tokenization and cached. */
export interface PreparedSelector {
  readonly selector: string
  /** Stage 1 form (pseudo-elements removed); null when the selector cannot be tokenized. */
  readonly raw: string | null
  /** Stage 2 form (state neutralized). */
  readonly normalized: string | null
  readonly rawTokens: RequiredTokens | null
  readonly normalizedTokens: RequiredTokens | null
  /** Token strings (`.c`, `#i`, `tag`, `[a]`) used to find candidates after DOM mutations. */
  readonly tokenStrings: readonly string[]
}

const caches = new WeakMap<StateConfig, Map<string, PreparedSelector>>()

function tokenStrings(tokens: RequiredTokens | null): string[] {
  if (!tokens) return []
  return [
    ...tokens.classes.map(name => `.${name}`),
    ...tokens.ids.map(name => `#${name}`),
    ...tokens.types,
    ...tokens.attributes.map(name => `[${name}]`),
  ]
}

export function prepareSelector(
  selector: string,
  state: StateConfig = DEFAULT_STATE,
): PreparedSelector {
  let cache = caches.get(state)
  if (!cache) {
    cache = new Map()
    caches.set(state, cache)
  }
  const cached = cache.get(selector)
  if (cached) return cached
  let prepared: PreparedSelector
  try {
    const tokens = tokenizeSelector(selector)
    const raw = rawTokens(tokens)
    const normalized = normalizeTokens(tokens, state)
    const rawRequired = requiredTokensOf(raw)
    const normalizedRequired = requiredTokensOf(normalized)
    prepared = {
      selector,
      raw: serializeTokens(raw),
      normalized: serializeTokens(normalized),
      rawTokens: rawRequired,
      normalizedTokens: normalizedRequired,
      tokenStrings: [
        ...new Set([...tokenStrings(rawRequired), ...tokenStrings(normalizedRequired)]),
      ],
    }
  } catch {
    prepared = {
      selector,
      raw: null,
      normalized: null,
      rawTokens: null,
      normalizedTokens: null,
      tokenStrings: [],
    }
  }
  cache.set(selector, prepared)
  return prepared
}
