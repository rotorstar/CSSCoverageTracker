export interface RouteKeyOptions {
  /** Keep the query string (query-routed views). @default false */
  readonly search?: boolean
  /** Keep the hash (hash routers). @default false */
  readonly hash?: boolean
}

/** Numeric ids, UUIDs and long hex hashes. */
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i

/**
 * Default route key: id-like path segments become `:id` so `/user/1` and
 * `/user/2` count as one route (and no ids end up in reports).
 */
export function defaultRouteKey(url: URL, options: RouteKeyOptions = {}): string {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map(segment => (ID_SEGMENT.test(segment) ? ':id' : segment))
  let key = `/${segments.join('/')}`
  if (options.search && url.search) key += url.search
  if (options.hash && url.hash) key += url.hash
  return key
}

/** Turn a concrete pathname into a pattern using route params (`/blog/a` + {slug:'a'} → `/blog/[slug]`). */
export function routePattern(pathname: string, params: Record<string, string | string[]>): string {
  let pattern = pathname
  for (const [name, value] of Object.entries(params)) {
    const parts = Array.isArray(value) ? value : [value]
    const joined = parts.map(encodeURIComponent).join('/')
    if (joined)
      pattern = pattern.replace(`/${joined}`, `/[${Array.isArray(value) ? `...${name}` : name}]`)
  }
  return pattern
}
