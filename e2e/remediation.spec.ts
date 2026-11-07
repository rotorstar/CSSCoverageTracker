/**
 * Plan AC-C: the Lightning CSS `unusedSymbols` export removes exactly the listed
 * classes and causes no visual regression (pixel-identical screenshot).
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, expect, test } from '@playwright/test'
import { launch } from 'chrome-launcher'
import lighthouse from 'lighthouse'
import { transform } from 'lightningcss'
import { pageReport, waitForTracker } from './helpers'

const run = promisify(execFile)
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cssClass = (name: string) => new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`)

test('unusedSymbols export → Lightning CSS → same pixels, smaller CSS', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'build pipeline check, browser independent')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/bootstrap.html')
  await waitForTracker(page)
  const dir = await mkdtemp(join(tmpdir(), 'css-coverage-fix-'))
  await writeFile(join(dir, 'report.json'), JSON.stringify(await pageReport(page)))
  const { stdout } = await run('node', [
    'dist/cli.mjs',
    'report',
    join(dir, 'report.json'),
    '--format',
    'lightningcss',
  ])
  const { unusedSymbols } = JSON.parse(stdout) as { unusedSymbols: string[] }
  expect(unusedSymbols.length).toBeGreaterThan(50)

  const original = await readFile('node_modules/bootstrap/dist/css/bootstrap.css')
  const purged = transform({
    filename: 'bootstrap.css',
    code: original,
    unusedSymbols,
  }).code.toString()
  await writeFile('fixtures/vite-app/public/bootstrap.purged.css', purged)

  expect(purged.length / original.length).toBeLessThan(0.8)
  // Lightning CSS drops a rule when every selector of its list references a listed symbol;
  // mixed lists such as `h3, .h3` stay intact (safe). So: nothing outside the list may disappear,
  // and the large majority of listed classes must be gone.
  const classesIn = (css: string): Set<string> =>
    new Set(
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].flatMap(m =>
        m[1] ? [m[1]] : [],
      ),
    )
  const before = classesIn(original.toString())
  const remaining = classesIn(purged)
  const listed = new Set(unusedSymbols)
  expect([...before].filter(name => !listed.has(name) && !remaining.has(name))).toEqual([])
  const stillThere = unusedSymbols.filter(name => cssClass(name).test(purged))
  expect(stillThere.length / unusedSymbols.length).toBeLessThan(0.1)
  for (const used of ['btn', 'btn-secondary', 'dropdown', 'dropdown-menu', 'dropdown-item']) {
    expect(unusedSymbols).not.toContain(used)
    expect(purged).toMatch(cssClass(used))
  }

  const shot = async (url: string) => {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.querySelector('css-coverage-panel')?.remove())
    return page.screenshot({ fullPage: true })
  }
  const pixelsBefore = await shot('/bootstrap.html')
  const pixelsAfter = await shot('/bootstrap-purged.html')
  expect(pixelsAfter.equals(pixelsBefore)).toBe(true)
})

/** Plan §10.6: Lighthouse confirms the effect — `unused-css-rules` savings shrink after remediation. */
test('Lighthouse unused-css-rules savings shrink after remediation', async ({
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'chromium', 'Lighthouse runs on Chromium')
  test.setTimeout(120_000)
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox'],
  })
  try {
    const savings = async (path: string): Promise<number> => {
      const result = await lighthouse(`${baseURL}${path}`, {
        port: chrome.port,
        onlyAudits: ['unused-css-rules'],
        logLevel: 'error',
        formFactor: 'desktop',
        screenEmulation: { disabled: true },
      })
      const details = result?.lhr.audits['unused-css-rules']?.details
      return details && 'overallSavingsBytes' in details
        ? Number(details.overallSavingsBytes ?? 0)
        : 0
    }
    const before = await savings('/bootstrap.html')
    const after = await savings('/bootstrap-purged.html')
    console.info(`Lighthouse unused-css-rules savings: before=${before} B, after=${after} B`)
    expect(before).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
  } finally {
    chrome.kill()
  }
})
