import type { SourceRecord } from '../engine/state'

/** Query parameters that dev servers and CDNs use as cache busters. */
const CACHE_BUSTERS = ['v', 't', 'ts', 'dpl', 'cb', '_', 'import', 'direct', 'inline']

/** URL without cache-buster query parameters and hash. */
export function normalizeHref(href: string, base?: string): string {
  try {
    const url = new URL(
      href,
      base ?? (typeof document === 'undefined' ? undefined : document.baseURI),
    )
    for (const name of CACHE_BUSTERS) url.searchParams.delete(name)
    url.hash = ''
    return url.href
  } catch {
    return href
  }
}

const constructedIds = new WeakMap<CSSStyleSheet, string>()
let constructedCounter = 0

/**
 * Stable key of a stylesheet across reloads and HMR updates: URL without cache
 * busters (`?v=`, `?ts=`, `?dpl=`), `style:<id>` for identifiable inline styles
 * (Vite's `data-vite-dev-id`), positional key for other inline styles, and a
 * per-page id for constructed sheets.
 */
export function sourceKey(sheet: CSSStyleSheet, index: number): string {
  if (sheet.href) return normalizeHref(sheet.href)
  const owner = sheet.ownerNode
  if (owner instanceof Element) {
    const id = owner.getAttribute('data-vite-dev-id') ?? owner.id
    return id ? `style:${id}` : `inline:${index}`
  }
  let id = constructedIds.get(sheet)
  if (!id) {
    id = `constructed:${++constructedCounter}`
    constructedIds.set(sheet, id)
  }
  return id
}

export function sourceKind(sheet: CSSStyleSheet, inShadowRoot: boolean): SourceRecord['kind'] {
  if (inShadowRoot) return 'shadow'
  const owner = sheet.ownerNode
  if (!owner) return 'adopted'
  return owner instanceof HTMLLinkElement ? 'link' : 'style'
}
