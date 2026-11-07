/**
 * Playwright fixture: collects a CSS coverage report for every test of an
 * existing E2E suite (interactions there open popovers, dialogs, … and turn
 * state-dependent selectors into used ones).
 *
 *   import { test, expect } from 'css-coverage-tracker/playwright'
 *
 * Reports are written to `coverage/css/<test>.json`; merge them with
 * `css-coverage merge coverage/css -o css-coverage.json`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base } from '@playwright/test'

export interface CssCoverageFixtureOptions {
  /** Directory for per-test reports. @default 'coverage/css' */
  cssCoverageDir: string
  /** Tracker options passed to the page (JSON-serializable subset). */
  cssCoverageOptions: Record<string, unknown>
}

const iife = fileURLToPath(new URL('./css-coverage-tracker.iife.js', import.meta.url))

export const test: ReturnType<
  typeof base.extend<CssCoverageFixtureOptions & { cssCoverage: undefined }>
> = base.extend<CssCoverageFixtureOptions & { cssCoverage: undefined }>({
  cssCoverageDir: ['coverage/css', { option: true }],
  cssCoverageOptions: [{}, { option: true }],
  cssCoverage: [
    async ({ context, cssCoverageDir, cssCoverageOptions }, use, testInfo) => {
      await context.addInitScript(
        options => {
          Reflect.set(globalThis, '__CSS_COVERAGE_CONFIG__', options)
        },
        { ui: false, force: true, expose: true, ...cssCoverageOptions },
      )
      await context.addInitScript({ path: iife })
      await use(undefined)
      const reports: unknown[] = []
      for (const page of context.pages()) {
        if (page.isClosed()) continue
        const report = await page
          .evaluate(async () => {
            const tracker: unknown = Reflect.get(globalThis, '__CSS_COVERAGE__')
            if (typeof tracker !== 'object' || tracker === null || !('getReport' in tracker))
              return null
            const t = tracker as {
              idle(): Promise<void>
              flush(): Promise<void>
              getReport(): Promise<unknown>
            }
            // classify interactions of the test's last moments (bounded wait)
            await Promise.race([t.idle(), new Promise(resolve => setTimeout(resolve, 5000))])
            await t.flush()
            return t.getReport()
          })
          .catch(() => null)
        if (report) reports.push(report)
      }
      if (reports.length === 0) return
      await mkdir(cssCoverageDir, { recursive: true })
      const title = testInfo.titlePath
        .join(' ')
        .replace(/[^\w-]+/g, '-')
        .slice(0, 80)
      // project + testId keep reports of different browsers and similar titles apart
      const slug = `${testInfo.project.name || 'default'}-${title}-${testInfo.testId}`.replace(
        /[^\w-]+/g,
        '-',
      )
      await Promise.all(
        reports.map((report, index) =>
          writeFile(
            join(cssCoverageDir, `${slug}-${testInfo.retry}-${index}.json`),
            JSON.stringify(report),
          ),
        ),
      )
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
