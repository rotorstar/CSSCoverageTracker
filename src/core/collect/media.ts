import { splitSelectorList } from '../selector/split-list'

/**
 * True when every query of a media query list targets the `print` media type
 * (`print`, `only print`, `print and (…)`). Empty lists apply to all media.
 */
export function isPrintOnly(mediaText: string): boolean {
  const queries = splitSelectorList(mediaText)
  if (queries.length === 0) return false
  return queries.every(query => /^(?:only\s+)?print(?:\s|$)/i.test(query.trim()))
}
