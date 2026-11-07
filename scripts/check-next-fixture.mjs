// AC-D: the README's Next.js snippets build and type-check in a real Next 16 app,
// and the production build contains 0 bytes of tracker code.
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

execFileSync('node', ['scripts/sync-readme-snippets.mjs'], { stdio: 'inherit' })
execFileSync('npm', ['--prefix', 'fixtures/next16', 'run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
})

const markers = [
  'css-coverage-panel',
  '__CSS_COVERAGE__',
  'data-css-coverage-ui',
  'css-coverage-tracker',
]
const hits = []
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await scan(path)
    else if (/\.(js|mjs|css|html|json)$/.test(entry.name)) {
      const text = await readFile(path, 'utf8')
      for (const marker of markers) if (text.includes(marker)) hits.push(`${path}: ${marker}`)
    }
  }
}
await scan('fixtures/next16/.next/static')
await scan('fixtures/next16/.next/server')
if (hits.length > 0) {
  console.error(`Tracker code found in the production build:\n${hits.join('\n')}`)
  process.exit(1)
}
console.log('✓ Next.js production build contains 0 bytes of tracker code')
