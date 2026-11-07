export interface RouteKeyOptions {
  /** Keep the query string (query-routed views). @default false */
  readonly search?: boolean
  /** Keep the hash (hash routers). @default false */
  readonly hash?: boolean
}

/** Numeric ids, UUIDs and long hex hashes. */
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i

/** A slug that carries an id (`title---<uuid>`, `name_<hash>`, `title-1234567`). */
const SLUG_WITH_ID =
  /[-_.~](?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{6,})$/i

/**
 * Default route key: id-like path segments become `:id` and slugs ending in an
 * id become `:slug`, so `/user/1` and `/user/2` count as one route (and no ids
 * end up in reports).
 */
export function defaultRouteKey(url: URL, options: RouteKeyOptions = {}): string {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map(segment =>
      ID_SEGMENT.test(segment) ? ':id' : SLUG_WITH_ID.test(segment) ? ':slug' : segment,
    )
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

const patternCache = new Map<string, RegExp>()

function compilePattern(pattern: string): RegExp {
  let compiled = patternCache.get(pattern)
  if (!compiled) {
    const segments = pattern.split('/').filter(Boolean)
    const wildcard = segments.at(-1) === '*'
    const source = (wildcard ? segments.slice(0, -1) : segments)
      .map(segment =>
        segment.startsWith(':') ? '/[^/]+' : `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      )
      .join('')
    compiled = new RegExp(`^${source}${wildcard ? '(?:/.*)?' : '/?'}$`)
    patternCache.set(pattern, compiled)
  }
  return compiled
}

/**
 * First route pattern that matches a pathname (`/jobs/:slug`, `/docs/*`), or
 * null. `:name` matches one segment, a trailing `*` any rest. Patterns are
 * plain strings, so they also work where functions cannot be passed (the
 * Playwright fixture, JSON config).
 */
export function matchRoutePattern(pathname: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) if (compilePattern(pattern).test(pathname)) return pattern
  return null
}
