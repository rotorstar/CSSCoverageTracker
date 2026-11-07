// Copies the built single-file tracker into the fixture app's public folder (script-tag pages).
import { copyFile } from 'node:fs/promises'

await copyFile(
  'dist/css-coverage-tracker.iife.js',
  'fixtures/vite-app/public/css-coverage-tracker.iife.js',
)
