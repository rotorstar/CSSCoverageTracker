/** E2E with the package's own Playwright fixture (dogfooding `css-coverage-tracker/playwright`). */
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '../dist/playwright.mjs'
import { find, pageReport, waitForTracker } from './helpers'

test.use({ cssCoverageDir: 'coverage/css-e2e' })

test('React + CSS Modules + Tailwind: routes, popover state, dark mode', async ({ page }) => {
  await page.goto('/')
  await waitForTracker(page)
  let report = await pageReport(page)
  const popoverOpen = find(report, /data-\\\[state\\=open\\\]\\:bg-sky-100/)
  expect(popoverOpen?.status).toBe('state-dependent')

  await page.getByTestId('trigger').click()
  await page.waitForTimeout(400)
  report = await pageReport(page)
  expect(find(report, /data-\\\[state\\=open\\\]\\:bg-sky-100/)?.status).toBe('used')

  await page.getByTestId('nav-admin').click()
  await page.waitForTimeout(400)
  await page.getByTestId('dark').click()
  await page.waitForTimeout(400)
  report = await pageReport(page)
  const adminPanel = find(report, /^\.\w*panel\w*$/)
  expect(adminPanel?.routes).toEqual(['/admin'])
  expect(report.routes.map(r => r.route).sort()).toEqual(['/', '/admin'])
  expect(report.coverage.ratio).toBe(1)
  expect(find(report, '.never-rendered-global')?.status).toBe('unused')
  expect(report.contexts.some(c => c.endsWith('dark'))).toBe(true)
})

test.describe('route patterns passed through the fixture', () => {
  test.use({ cssCoverageOptions: { routePatterns: ['/admin/*'] } })

  test('group routes without a routeKey function', async ({ page }) => {
    await page.goto('/')
    await waitForTracker(page)
    await page.getByTestId('nav-admin').click()
    await page.waitForTimeout(400)
    const report = await pageReport(page)
    expect(report.routes.map(r => r.route).sort()).toEqual(['/', '/admin/*'])
  })
})

test('two tabs of one context merge into one coverage (IndexedDB + BroadcastChannel)', async ({
  context,
}) => {
  const home = await context.newPage()
  await home.goto('/')
  await waitForTracker(home)
  const admin = await context.newPage()
  await admin.goto('/admin')
  await waitForTracker(admin)
  await pageReport(admin)
  const report = await pageReport(home)
  expect(report.routes.map(r => r.route).sort()).toEqual(['/', '/admin'])
})

test('HMR: a rule deleted from a loaded stylesheet becomes stale', async ({ page }) => {
  const file = new URL('../fixtures/vite-app/src/hmr.css', import.meta.url)
  const original = await readFile(file, 'utf8')
  try {
    await page.goto('/')
    await waitForTracker(page)
    expect(find(await pageReport(page), '.hmr-remove')?.stale).toBe(false)
    await writeFile(file, '.hmr-keep {\n  color: green;\n}\n')
    await expect
      .poll(
        async () => {
          await page.evaluate(() =>
            (Reflect.get(globalThis, '__CSS_COVERAGE__') as { scan(): Promise<void> }).scan(),
          )
          return find(await pageReport(page), '.hmr-remove')?.stale
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    expect(find(await pageReport(page), '.hmr-keep')?.stale).toBe(false)
  } finally {
    await writeFile(file, original)
  }
})

test('Lit web component: adopted stylesheets inside the shadow root are analyzed', async ({
  page,
}) => {
  await page.goto('/lit.html')
  await page.waitForFunction(() => customElements.get('fancy-card') !== undefined)
  await waitForTracker(page)
  await page.evaluate(() =>
    (Reflect.get(globalThis, '__CSS_COVERAGE__') as { scan(): Promise<void> }).scan(),
  )
  const report = await pageReport(page)
  expect(find(report, '.title')?.status).toBe('used')
  expect(find(report, '.unused-in-shadow')?.status).toBe('unused')
  expect(find(report, ':host([hidden])')?.status).toBe('state-dependent')
})

test('legacy Bootstrap page via script tag: JS state classes are not reported unused', async ({
  page,
}) => {
  await page.goto('/bootstrap.html')
  await waitForTracker(page)
  const report = await pageReport(page)
  expect(find(report, '.dropdown-menu.show')?.status).toBe('state-dependent')
  expect(
    report.sources.some(s => s.href?.includes('bootstrap.css') && (s.decodedBytes ?? 0) > 100_000),
  ).toBe(true)
})
