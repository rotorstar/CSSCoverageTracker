// Rebuilds the real-CSS fixtures used by the golden corpus tests.
import { execFileSync } from 'node:child_process'

execFileSync(
  'npx',
  [
    '@tailwindcss/cli',
    '-i',
    'test/fixtures/tailwind/input.css',
    '-o',
    'test/fixtures/tailwind/output.css',
  ],
  { stdio: 'inherit' },
)
