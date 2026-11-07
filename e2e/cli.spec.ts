/** CI gate end-to-end: reports written by the fixture, merged and checked by the real CLI binary. */
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { pageReport, waitForTracker } from './helpers'

const run = promisify(execFile)
const cli = (args: string[]) =>
  run('node', ['dist/cli.mjs', ...args]).then(
    r => ({ code: 0, out: r.stdout }),
    (e: { code: number; stdout: string }) => ({ code: e.code, out: e.stdout }),
  )

test('css-coverage check fails above the budget and passes below it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CLI behaviour is browser independent')
  await page.addInitScript(() =>
    Reflect.set(globalThis, '__CSS_COVERAGE_CONFIG__', { expose: true, ui: false }),
  )
  await page.goto('/bootstrap.html')
  await waitForTracker(page)
  const dir = await mkdtemp(join(tmpdir(), 'css-coverage-'))
  await writeFile(join(dir, 'run.json'), JSON.stringify(await pageReport(page)))

  const strict = await cli(['check', dir, '--max-unused-kb', '1'])
  expect(strict.code).toBe(1)
  expect(strict.out).toContain('failed')

  const loose = await cli(['check', dir, '--max-unused-kb', '100000', '--max-unused-pct', '100'])
  expect(loose.code).toBe(0)

  const merged = await cli(['merge', dir])
  expect(JSON.parse(merged.out).schema).toBe('css-coverage/v2')
  const md = await cli(['report', dir, '--format', 'md'])
  expect(md.out).toContain('# CSS coverage report')
})
