// Size budgets (plan AC-D): always-loaded code vs. lazily loaded UI/report chunks.
// Follows the STATIC import graph of each entry (dynamic import() = lazy), minifies
// every chunk with esbuild (no re-bundling) and measures gzip size.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { transformSync } from 'esbuild'

const DIST = 'dist'
const budgets = [
  { name: 'core (always loaded)', entry: 'index.js', limit: 11 * 1024 },
  { name: 'react adapter (always loaded)', entry: 'react.js', limit: 11.5 * 1024 },
  { name: 'UI + report (lazy)', lazyOf: 'index.js', limit: 12 * 1024 },
]

const read = file => readFileSync(join(DIST, file), 'utf8')
const staticImports = file =>
  [
    ...read(file).matchAll(/(?:^|[;\n])\s*(?:import|export)\s[^'"]*?from\s*["'](\.\/[^"']+)["']/g),
  ].map(m => m[1].slice(2))
const dynamicImports = file =>
  [...read(file).matchAll(/import\(\s*["'](\.\/[^"']+)["']\s*\)/g)].map(m => m[1].slice(2))

function closure(entry) {
  const seen = new Set()
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    for (const dep of staticImports(file)) visit(join(dirname(file), dep))
  }
  visit(entry)
  return seen
}

const size = files =>
  [...files].reduce((sum, file) => {
    const { code } = transformSync(read(file), { minify: true, format: 'esm', loader: 'js' })
    return sum + gzipSync(code, { level: 9 }).length
  }, 0)

let failed = false
for (const budget of budgets) {
  let files
  if (budget.entry) files = closure(budget.entry)
  else {
    const eager = closure(budget.lazyOf)
    files = new Set()
    for (const file of eager)
      for (const lazy of dynamicImports(file))
        for (const f of closure(lazy)) if (!eager.has(f)) files.add(f)
  }
  const bytes = size(files)
  const ok = bytes <= budget.limit
  failed ||= !ok
  console.log(
    `${ok ? '✓' : '✗'} ${budget.name}: ${(bytes / 1024).toFixed(2)} kB gz (limit ${(budget.limit / 1024).toFixed(1)} kB) — ${[...files].join(', ')}`,
  )
}
process.exit(failed ? 1 : 0)
