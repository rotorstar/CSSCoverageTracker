/**
 * Minimal, dependency-free CSS selector tokenizer for ONE complex selector
 * (no top-level commas — use `splitSelectorList` first).
 *
 * It understands escapes (`.md\:hover`), quoted strings, attribute brackets and
 * arbitrarily nested functional pseudo-class arguments. It does not validate
 * selectors; the browser stays the oracle for validity.
 */

export type TokenKind =
  | 'combinator'
  | 'type'
  | 'class'
  | 'id'
  | 'attribute'
  | 'pseudo-class'
  | 'pseudo-element'
  | 'nesting'

export interface Token {
  readonly kind: TokenKind
  /** Source text of the token (combinators normalized to ' ', '>', '+', '~'). */
  readonly text: string
  /** Lowercased name for pseudos and attributes, unescaped name for classes/ids. */
  readonly name: string
  /** Raw argument of a functional pseudo (between the parentheses). */
  readonly argument?: string
}

export class SelectorSyntaxError extends Error {
  override readonly name = 'SelectorSyntaxError'
}

/** Pseudo-elements that also accept the legacy single-colon syntax. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter'])

const HEX = /^[0-9a-fA-F]$/
const WHITESPACE = /^[ \t\n\r\f]$/

function isIdentChar(char: string): boolean {
  return /^[A-Za-z0-9_-]$/.test(char) || char.charCodeAt(0) >= 0x80
}

/** Index after an escape sequence starting at `start` (which points to the backslash). */
function skipEscape(input: string, start: number): number {
  let i = start + 1
  if (i >= input.length) return i
  if (HEX.test(input[i] ?? '')) {
    let digits = 0
    while (i < input.length && digits < 6 && HEX.test(input[i] ?? '')) {
      i++
      digits++
    }
    if (WHITESPACE.test(input[i] ?? '')) i++
    return i
  }
  return i + 1
}

/** Index after an identifier starting at `start`. */
function readIdent(input: string, start: number): number {
  let i = start
  while (i < input.length) {
    const char = input[i] ?? ''
    if (char === '\\') i = skipEscape(input, i)
    else if (isIdentChar(char)) i++
    else break
  }
  return i
}

/** Index after a quoted string starting at `start` (which points to the quote). */
export function skipString(input: string, start: number): number {
  const quote = input[start]
  let i = start + 1
  while (i < input.length) {
    const char = input[i]
    if (char === '\\') i += 2
    else if (char === quote) return i + 1
    else i++
  }
  throw new SelectorSyntaxError(`Unterminated string in "${input}"`)
}

/** Index after the block closed by `close`, starting after the opening bracket. */
export function skipBlock(input: string, start: number, close: ')' | ']'): number {
  let depth = 1
  let i = start
  while (i < input.length) {
    const char = input[i]
    if (char === '\\') i = skipEscape(input, i)
    else if (char === '"' || char === "'") i = skipString(input, i)
    else if (char === '(' || char === '[') {
      depth++
      i++
    } else if (char === ')' || char === ']') {
      depth--
      i++
      if (depth === 0) {
        if (char !== close) throw new SelectorSyntaxError(`Mismatched bracket in "${input}"`)
        return i
      }
    } else i++
  }
  throw new SelectorSyntaxError(`Unbalanced brackets in "${input}"`)
}

/** Resolve CSS escapes in an identifier (`md\:hover` → `md:hover`). */
export function unescapeIdent(ident: string): string {
  let out = ''
  let i = 0
  while (i < ident.length) {
    const char = ident[i] ?? ''
    if (char !== '\\') {
      out += char
      i++
      continue
    }
    const end = skipEscape(ident, i)
    const body = ident.slice(i + 1, end).trim()
    out += HEX.test(body[0] ?? '') ? String.fromCodePoint(Number.parseInt(body, 16)) : body
    i = end
  }
  return out
}

export function tokenizeSelector(selector: string): Token[] {
  const input = selector.trim()
  const tokens: Token[] = []
  let i = 0

  const pushCombinator = (text: string): void => {
    const last = tokens.at(-1)
    if (last?.kind === 'combinator') {
      // ' ' followed by '>' etc. collapses into the explicit combinator
      if (text !== ' ') tokens[tokens.length - 1] = { kind: 'combinator', text, name: text }
      return
    }
    tokens.push({ kind: 'combinator', text, name: text })
  }

  while (i < input.length) {
    const char = input[i] ?? ''
    const start = i

    if (WHITESPACE.test(char)) {
      while (WHITESPACE.test(input[i] ?? '')) i++
      pushCombinator(' ')
    } else if (char === '>' || char === '+' || char === '~') {
      i++
      pushCombinator(char)
    } else if (char === '.' || char === '#') {
      i = readIdent(input, i + 1)
      if (i === start + 1) throw new SelectorSyntaxError(`Empty ${char} in "${input}"`)
      tokens.push({
        kind: char === '.' ? 'class' : 'id',
        text: input.slice(start, i),
        name: unescapeIdent(input.slice(start + 1, i)),
      })
    } else if (char === '[') {
      i = skipBlock(input, i + 1, ']')
      // strip a namespace prefix (`xlink|href`, `*|x`) but not the `|=` operator
      const unprefixed = input
        .slice(start + 1, i - 1)
        .trim()
        .replace(/^[*\w-]*\|(?!=)/, '')
      const name = unprefixed.slice(0, readIdent(unprefixed, 0))
      tokens.push({ kind: 'attribute', text: input.slice(start, i), name: name.toLowerCase() })
    } else if (char === ':') {
      const isElement = input[i + 1] === ':'
      const nameStart = i + (isElement ? 2 : 1)
      i = readIdent(input, nameStart)
      const name = unescapeIdent(input.slice(nameStart, i)).toLowerCase()
      let argument: string | undefined
      if (input[i] === '(') {
        const argStart = i + 1
        i = skipBlock(input, argStart, ')')
        argument = input.slice(argStart, i - 1)
      }
      const kind = isElement || LEGACY_PSEUDO_ELEMENTS.has(name) ? 'pseudo-element' : 'pseudo-class'
      const text = input.slice(start, i)
      tokens.push(argument === undefined ? { kind, text, name } : { kind, text, name, argument })
    } else if (char === '&') {
      i++
      tokens.push({ kind: 'nesting', text: '&', name: '&' })
    } else if (char === '*' || char === '|' || char === '\\' || isIdentChar(char)) {
      if (char === '*') i++
      else i = readIdent(input, i)
      if (input[i] === '|' && input[i + 1] !== '=') {
        i++
        if (input[i] === '*') i++
        else i = readIdent(input, i)
      }
      const text = input.slice(start, i)
      tokens.push({ kind: 'type', text, name: unescapeIdent(text).toLowerCase() })
    } else {
      throw new SelectorSyntaxError(`Unexpected "${char}" in "${input}"`)
    }
  }

  if (tokens.at(-1)?.kind === 'combinator') tokens.pop()
  return tokens
}

/** Serialize tokens back to selector text; empty compounds become `*`. */
export function serializeTokens(tokens: readonly Token[]): string {
  let out = ''
  let compoundEmpty = true
  for (const token of tokens) {
    if (token.kind === 'combinator') {
      if (compoundEmpty && out !== '') out += '*'
      out += token.text === ' ' ? ' ' : ` ${token.text} `
      compoundEmpty = true
    } else {
      out += token.text
      compoundEmpty = false
    }
  }
  if (compoundEmpty) out += '*'
  return out.replace(/ {2,}/g, ' ').trim()
}
