/**
 * Side-effect entry: `import 'css-coverage-tracker/auto'` (Vite, Vue, Svelte,
 * Astro, plain HTML). Reads optional options from `window.__CSS_COVERAGE_CONFIG__`.
 */
import { createCoverageTracker, type TrackerOptions } from '../core/api'

function readConfig(): TrackerOptions {
  const fromGlobal: unknown = Reflect.get(globalThis, '__CSS_COVERAGE_CONFIG__')
  // <script src="…iife.js" data-css-coverage='{"knownRoutes":["/"]}'> — works under strict CSP
  const script = typeof document === 'undefined' ? null : document.currentScript
  let fromAttribute: unknown = {}
  try {
    fromAttribute = JSON.parse(script?.getAttribute('data-css-coverage') ?? '{}')
  } catch {
    fromAttribute = {}
  }
  return {
    ...(typeof fromAttribute === 'object' && fromAttribute !== null ? fromAttribute : {}),
    ...(typeof fromGlobal === 'object' && fromGlobal !== null ? fromGlobal : {}),
  }
}

if (typeof document !== 'undefined') {
  void createCoverageTracker(readConfig()).start()
}
