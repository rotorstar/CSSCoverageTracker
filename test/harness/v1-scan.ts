/** The v1 matching algorithm (regex strip + querySelectorAll), kept only as a benchmark baseline. */
const PSEUDO_ELEMENT_RE = /::[a-z-]+(\([^)]*\))?/gi
const PSEUDO_CLASS_RE =
  /:(?:hover|focus|active|visited|focus-within|focus-visible|disabled|checked|first-child|last-child|nth-child\([^)]*\)|first-of-type|last-of-type|not\([^)]*\)|where\([^)]*\)|is\([^)]*\)|has\([^)]*\))/g

export function v1Scan(selectors: readonly string[]): number {
  let matched = 0
  for (const selector of selectors) {
    const stripped = selector.replace(PSEUDO_ELEMENT_RE, '').replace(PSEUDO_CLASS_RE, '').trim()
    try {
      if (!stripped || stripped === '*' || document.querySelectorAll(stripped).length > 0) matched++
    } catch {
      /* invalid */
    }
  }
  return matched
}

/** Size of the v1 localStorage payload for the same selectors. */
export function v1StorageSize(selectors: readonly string[], source: string): number {
  const data: Record<string, unknown> = {}
  for (const selector of selectors) {
    data[selector] = { selector, matched: false, printOnly: false, source }
  }
  return JSON.stringify({ selectors: data, pages: ['/'], lastScan: Date.now() }).length
}
