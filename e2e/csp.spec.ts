/** Strict CSP + Trusted Types (plan AC-C, M9): the panel works and causes 0 violations. */
import { expect, test } from '@playwright/test'

test('panel and report work under strict CSP with 0 violations', async ({ page }) => {
  const violations: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      const list = (Reflect.get(globalThis, '__violations') as string[] | undefined) ?? []
      list.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
      )
      Reflect.set(globalThis, '__violations', list)
    })
  })
  page.on('console', message => {
    if (/Content Security Policy|TrustedHTML|Trusted Type/i.test(message.text()))
      violations.push(message.text())
  })
  await page.goto('/csp.html')
  const badge = page.locator('css-coverage-panel').locator('.badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(/CSS \d+% unused/)
  await badge.click()
  const dialog = page.locator('css-coverage-panel').locator('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Unused:')
  await expect(dialog.locator('.results')).toContainText('csp.css')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const recorded = (await page.evaluate(() => Reflect.get(globalThis, '__violations'))) as
    | string[]
    | undefined
  expect([...(recorded ?? []), ...violations]).toEqual([])
})
