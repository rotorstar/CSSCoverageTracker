import { skipBlock, skipString } from './tokenize'

/**
 * Split a selector list at top-level commas only — never inside `:is()`,
 * `:where()`, `:not()`, attribute values, strings or after an escape.
 */
export function splitSelectorList(list: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < list.length) {
    const char = list[i]
    if (char === '\\') i += 2
    else if (char === '"' || char === "'") i = skipString(list, i)
    else if (char === '(') i = skipBlock(list, i + 1, ')')
    else if (char === '[') i = skipBlock(list, i + 1, ']')
    else if (char === ',') {
      parts.push(list.slice(start, i))
      start = ++i
    } else i++
  }
  parts.push(list.slice(start))
  return parts.map(part => part.trim()).filter(part => part.length > 0)
}
