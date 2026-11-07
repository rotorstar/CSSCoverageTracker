import type { RequiredTokens } from '../selector/required-tokens'
import type { MatchRoot } from '../types'

/**
 * Set of class names, ids, type and attribute names present in a tree, built in
 * one pass. A selector whose required tokens are not all present cannot match,
 * so the expensive `querySelector` call is skipped (plan B1). The index only
 * grows: stale entries merely disable a skip, they never cause a false "unused".
 */
export class DomIndex {
  private readonly classes = new Set<string>()
  private readonly ids = new Set<string>()
  private readonly types = new Set<string>()
  private readonly attributes = new Set<string>()

  private constructor(private readonly exclude?: (element: Element) => boolean) {}

  static build(root: MatchRoot, exclude?: (element: Element) => boolean): DomIndex {
    const index = new DomIndex(exclude)
    for (const element of Array.from(root.querySelectorAll('*'))) index.addElement(element)
    return index
  }

  /** Index an element and its descendants; returns the tokens seen (`.c`, `#i`, `tag`, `[attr]`). */
  add(element: Element): string[] {
    const seen: string[] = []
    this.addElement(element, seen)
    for (const child of Array.from(element.querySelectorAll('*'))) this.addElement(child, seen)
    return seen
  }

  /** Index one element without its descendants (attribute changes). */
  addOne(element: Element): string[] {
    const seen: string[] = []
    this.addElement(element, seen)
    return seen
  }

  has(tokens: RequiredTokens): boolean {
    return (
      tokens.classes.every(name => this.classes.has(name)) &&
      tokens.ids.every(name => this.ids.has(name)) &&
      tokens.types.every(name => this.types.has(name)) &&
      tokens.attributes.every(name => this.attributes.has(name))
    )
  }

  private addElement(element: Element, seen?: string[]): void {
    if (this.exclude?.(element)) return
    const type = element.localName.toLowerCase()
    this.types.add(type)
    seen?.push(type)
    for (const name of Array.from(element.classList)) {
      this.classes.add(name)
      seen?.push(`.${name}`)
    }
    if (element.id) {
      this.ids.add(element.id)
      seen?.push(`#${element.id}`)
    }
    for (const name of element.getAttributeNames()) {
      const lower = name.toLowerCase()
      this.attributes.add(lower)
      seen?.push(`[${lower}]`)
    }
  }
}
