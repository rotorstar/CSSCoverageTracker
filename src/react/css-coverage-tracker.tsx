'use client'

import { useEffect, useRef } from 'react'
import {
  type CoverageTracker,
  createCoverageTracker,
  getCoverageTracker,
  type TrackerOptions,
} from '../core/api'

/** Badge position on the viewport. */
export type BadgePosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/** v1 configuration (still supported). */
export interface CSSCoverageConfig {
  /** Storage key (IndexedDB; v1 localStorage data under this key is migrated). @default 'css-coverage-tracker' */
  storageKey?: string
  /** v1 "delay after navigation"; v2 re-checks continuously and uses it as mutation debounce. */
  scanDelay?: number
  /** Ignored since v2: the badge lives in the browser's top layer. */
  zIndex?: number
  /** Badge position. @default 'bottom-left' */
  position?: BadgePosition
}

export interface CSSCoverageTrackerProps {
  /**
   * Current pathname from your router (`usePathname()`, `useLocation().pathname`).
   * Omit it to let the tracker follow navigations itself (Navigation API).
   */
  pathname?: string
  /** Route pattern for grouping (`/blog/[slug]`), e.g. `routePattern(pathname, useParams())`. */
  route?: string
  /** v1 configuration. */
  config?: CSSCoverageConfig
  /** All v2 tracker options (route inventory, state lists, CORS fetching, …). */
  options?: TrackerOptions
}

/**
 * Renders nothing itself: it starts the shared coverage tracker, whose badge
 * and report live in an isolated shadow root under `<html>`.
 */
export function CSSCoverageTracker({
  pathname,
  route,
  config,
  options,
}: CSSCoverageTrackerProps): null {
  const tracker = useRef<CoverageTracker | null>(null)
  const controlled = pathname !== undefined || route !== undefined

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tracker is created once per mount
  useEffect(() => {
    // reuse a tracker started elsewhere (Playwright fixture, /auto, script tag) without owning it
    const shared = getCoverageTracker()
    const instance =
      shared ??
      createCoverageTracker({
        ...(config?.storageKey ? { storageKey: config.storageKey } : {}),
        ...(config?.scanDelay !== undefined
          ? { debounceMs: Math.min(config.scanDelay, 1000) }
          : {}),
        ...(config?.position ? { position: config.position } : {}),
        navigation: controlled ? 'manual' : 'auto',
        ...options,
      })
    if (shared && options) shared.configure(options)
    tracker.current = instance
    void instance.start()
    return () => {
      if (!shared) instance.stop()
      tracker.current = null
    }
  }, [])

  useEffect(() => {
    if (!controlled || !tracker.current) return
    const instance = tracker.current
    void instance
      .start()
      .then(() => instance.notifyNavigation(route ?? instance.routeFor(pathname ?? '/')))
  }, [pathname, route, controlled])

  return null
}
