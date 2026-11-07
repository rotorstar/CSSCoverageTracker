/** The README's Next.js 16 setup (synced into fixtures/next16) works in development. */
import { expect, test } from '@playwright/test'

test('Next.js dev: badge appears and the page CSS is covered', async ({ page }) => {
  test.setTimeout(150_000) // `next dev` compiles the route and the lazy tracker chunk on first request
  await page.goto('http://localhost:5200/')
  const badge = page.locator('css-coverage-panel').locator('.badge')
  await expect(badge).toBeVisible({ timeout: 120_000 })
  await expect(badge).toHaveText(/CSS \d+% unused · .* · 1 route/)
  await badge.click()
  const dialog = page.locator('css-coverage-panel').locator('dialog')
  await expect(dialog).toContainText('Unused:')
  await dialog.locator('select').first().selectOption('selectors')
  await dialog.locator('input[type="search"]').fill('unused')
  await expect(dialog.locator('.results')).toContainText('unused')
  // (Escape inside a search field first clears it; close explicitly)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()

  // Base UI popover (shadcn default): its popup only exists while open
  await page.getByRole('button', { name: 'Open popover' }).click()
  await expect(page.getByText('Popover content')).toBeVisible()
  // re-checks are guaranteed within the 1 s max wait (the input-time flush is an extra safety net)
  await page.waitForTimeout(1200)
  await badge.click()
  await dialog.locator('select').first().selectOption('selectors')
  await dialog.locator('select').nth(1).selectOption('used')
  await dialog.locator('input[type="search"]').fill('data-open')
  await expect(dialog.locator('.results')).toContainText('data-open\\:ring-2')
})
