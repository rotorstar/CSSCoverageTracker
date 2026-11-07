import { splitSelectorList } from '../selector/split-list'
import { tokenizeSelector } from '../selector/tokenize'

/** Every class and id name in a selector, including inside `:is()`, `:not()`, `:has()`, … */
export function selectorNames(selector: string): { classes: string[]; ids: string[] } {
  const classes = new Set<string>()
  const ids = new Set<string>()
  const visit = (text: string): void => {
    for (const part of splitSelectorList(text)) {
      for (const token of tokenizeSelector(part)) {
        if (token.kind === 'class') classes.add(token.name)
        else if (token.kind === 'id') ids.add(token.name)
        else if (token.argument !== undefined && /[.#]/.test(token.argument)) {
          try {
            visit(token.argument)
          } catch {
            /* nth-child formulas etc. are not selector lists */
          }
        }
      }
    }
  }
  try {
    visit(selector)
  } catch {
    /* unparsable selector: no names */
  }
  return { classes: [...classes], ids: [...ids] }
}
