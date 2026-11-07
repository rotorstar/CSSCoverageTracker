import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CoverageTracker, createCoverageTracker } from '../../src/index'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function setup(): Promise<{
  tracker: CoverageTracker
  host: HTMLElement
  shadow: ShadowRoot
}> {
  const style = document.createElement('style')
  style.textContent =
    'body > button{color:red} h2{margin:0} dialog{color:red} :last-child{outline:0} .app{color:red} .dead{color:blue}'
  document.head.append(style)
  const app = document.createElement('main')
  app.className = 'app'
  document.body.append(app)
  cleanups.push(() => {
    style.remove()
    app.remove()
  })
  const tracker = createCoverageTracker({
    storage: 'memory',
    navigation: 'manual',
    singleton: false,
    force: true,
  })
  cleanups.push(() => tracker.stop())
  await tracker.start()
  tracker.notifyNavigation('/')
  await tracker.idle()
  const host = document.querySelector<HTMLElement>('css-coverage-panel')
  if (!host?.shadowRoot) throw new Error('panel not mounted')
  return { tracker, host, shadow: host.shadowRoot }
}

const statuses = (t: CoverageTracker) =>
  [...t.getState().selectors.values()].map(r => `${r.selector}=${r.status}`).sort()

describe('UI panel (C3)', () => {
  it('mounts under <html> (not <body>) with a badge showing unused share and routes', async () => {
    const { host, shadow } = await setup()
    expect(host.parentElement).toBe(document.documentElement)
    expect(host.hasAttribute('data-css-coverage-ui')).toBe(true)
    expect(shadow.querySelector('.badge')?.textContent).toMatch(/CSS \d+% unused · .* KB · 1 route/)
  })

  it('opens the report as an accessible dialog (axe: 0 violations)', async () => {
    const { shadow } = await setup()
    const badge = shadow.querySelector<HTMLButtonElement>('.badge')
    badge?.click()
    const dialog = shadow.querySelector('dialog')
    expect(dialog?.open).toBe(true)
    await vi.waitFor(() => expect(dialog?.textContent).toMatch(/Unused:/), { timeout: 5000 })
    const result = await axe.run(dialog as Element, { runOnly: ['wcag2a', 'wcag2aa'] })
    expect(result.violations.map(v => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('Escape closes the dialog and focus returns to the badge; Alt+Shift+C toggles it', async () => {
    const { shadow } = await setup()
    const badge = shadow.querySelector<HTMLButtonElement>('.badge')
    badge?.focus()
    badge?.click()
    const dialog = shadow.querySelector('dialog')
    expect(dialog?.open).toBe(true)
    dialog?.dispatchEvent(new Event('cancel', { cancelable: true }))
    dialog?.close()
    expect(dialog?.open).toBe(false)
    expect(shadow.activeElement).toBe(badge)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyC', altKey: true, shiftKey: true }),
    )
    expect(dialog?.open).toBe(true)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyC', altKey: true, shiftKey: true }),
    )
    expect(dialog?.open).toBe(false)
  })

  it('opening the panel and rescanning changes no status (no self-contamination)', async () => {
    const { tracker, shadow } = await setup()
    const before = statuses(tracker)
    shadow.querySelector<HTMLButtonElement>('.badge')?.click()
    await vi.waitFor(() => expect(shadow.querySelector('dialog')?.textContent).toMatch(/Unused:/), {
      timeout: 5000,
    })
    await tracker.scan()
    expect(statuses(tracker)).toEqual(before)
    expect(before).toContain('body > button=unused')
    expect(before).toContain('dialog=unused')
  })

  it('keeps build-tool exports disabled without a route inventory (confidence gate)', async () => {
    const { shadow } = await setup()
    shadow.querySelector<HTMLButtonElement>('.badge')?.click()
    await vi.waitFor(() => expect(shadow.querySelector('dialog')?.textContent).toMatch(/Unused:/), {
      timeout: 5000,
    })
    const lightning = [...shadow.querySelectorAll('button')].find(
      b => b.textContent === 'Lightning CSS',
    )
    expect(lightning?.disabled).toBe(true)
  })
})

describe('badge updates never break a click in progress', () => {
  it('keeps the same text node when the numbers change', async () => {
    const { tracker, shadow } = await setup()
    const badge = shadow.querySelector('.badge')
    const node = badge?.firstChild
    const style = document.createElement('style')
    style.textContent = '.another-dead-rule{color:red}'
    document.head.append(style)
    cleanups.push(() => style.remove())
    await tracker.scan()
    expect(badge?.firstChild).toBe(node)
  })
})
