import type { Page } from '@playwright/test'
import type { Report } from '../src/core/report/types'

/** Report of the tracker running in the page (exposed by the fixture or `data-css-coverage`). */
export async function pageReport(page: Page): Promise<Report> {
  return page.evaluate(async () => {
    const tracker = Reflect.get(globalThis, '__CSS_COVERAGE__') as {
      idle(): Promise<void>
      flush(): Promise<void>
      getReport(): Promise<unknown>
    }
    await tracker.idle()
    await tracker.flush()
    return tracker.getReport()
  }) as Promise<Report>
}

export async function waitForTracker(page: Page): Promise<void> {
  await page.waitForFunction(() => Reflect.get(globalThis, '__CSS_COVERAGE__') !== undefined)
  await page.evaluate(() =>
    (Reflect.get(globalThis, '__CSS_COVERAGE__') as { idle(): Promise<void> }).idle(),
  )
}

export function find(
  report: Report,
  needle: string | RegExp,
): Report['selectors'][number] | undefined {
  return report.selectors.find(s =>
    typeof needle === 'string' ? s.selector === needle : needle.test(s.selector),
  )
}
