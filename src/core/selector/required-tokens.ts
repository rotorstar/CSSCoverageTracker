import { type Token, tokenizeSelector } from './tokenize'

/** Tokens that every element matched by a selector (or its subject chain) must carry. */
export interface RequiredTokens {
  readonly classes: readonly string[]
  readonly ids: readonly string[]
  /** Lowercase local names. */
  readonly types: readonly string[]
  /** Lowercase attribute names. */
  readonly attributes: readonly string[]
}

/**
 * Necessary-condition tokens of a selector: classes, ids, type and attribute
 * names of its top-level compounds. Arguments of functional pseudo-classes
 * (`:is`, `:not`, `:has`, …) are ignored because they are not required.
 * Returns `null` when no safe statement is possible (`:host` selectors).
 */
export function requiredTokens(selector: string): RequiredTokens | null {
  return requiredTokensOf(tokenizeSelector(selector))
}

/** Token form of {@link requiredTokens}. */
export function requiredTokensOf(tokens: readonly Token[]): RequiredTokens | null {
  const first = tokens[0]
  if (first?.kind === 'pseudo-class' && (first.name === 'host' || first.name === 'host-context')) {
    return null
  }
  const classes: string[] = []
  const ids: string[] = []
  const types: string[] = []
  const attributes: string[] = []
  for (const token of tokens) {
    if (token.kind === 'class') classes.push(token.name)
    else if (token.kind === 'id') ids.push(token.name)
    else if (token.kind === 'attribute' && token.name !== '') attributes.push(token.name)
    else if (token.kind === 'type' && token.name !== '*' && !token.name.includes('|')) {
      types.push(token.name)
    }
  }
  return { classes, ids, types, attributes }
}
