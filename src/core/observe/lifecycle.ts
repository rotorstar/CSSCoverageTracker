/** Anything with the `prerendering` flag of a Document (testable with a plain EventTarget). */
export interface PrerenderTarget extends EventTarget {
  readonly prerendering?: boolean
}

/**
 * Resolves once the document is shown to the user. Scanning a prerendered page
 * would record a route the user never visited ("phantom route").
 */
export function waitUntilActive(target: PrerenderTarget): Promise<void> {
  if (!target.prerendering) return Promise.resolve()
  return new Promise(resolve => {
    target.addEventListener('prerenderingchange', () => resolve(), { once: true })
  })
}
