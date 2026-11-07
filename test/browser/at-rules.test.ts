import { afterEach, describe, expect, it } from 'vitest'
import { createCoverageTracker } from '../../src/index'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('unused @keyframes and @font-face (C7)', () => {
  it('reports keyframes without a live reference and fonts that were never loaded', async () => {
    const style = document.createElement('style')
    style.textContent = `
      @keyframes spin-used { to { transform: rotate(1turn) } }
      @keyframes fade-dead { to { opacity: 0 } }
      @keyframes pulse-dead-rule { to { opacity: .5 } }
      .spinner { animation: spin-used 1s linear infinite }
      .gone { animation-name: pulse-dead-rule }
      @font-face { font-family: "Never Used Font"; src: local("Arial") }`
    document.head.append(style)
    const el = document.createElement('i')
    el.className = 'spinner'
    document.body.append(el)
    cleanups.push(() => {
      style.remove()
      el.remove()
    })
    const tracker = createCoverageTracker({
      storage: 'memory',
      navigation: 'manual',
      singleton: false,
      ui: false,
      force: true,
    })
    cleanups.push(() => tracker.stop())
    await tracker.start()
    tracker.notifyNavigation('/')
    await tracker.idle()
    const report = await tracker.getReport()
    const keyframes = Object.fromEntries(report.atRules.keyframes.map(k => [k.name, k.used]))
    expect(keyframes).toEqual({ 'spin-used': true, 'fade-dead': false, 'pulse-dead-rule': false })
    expect(report.atRules.fontFaces.find(f => f.family === 'Never Used Font')?.loaded).toBe(false)
  })
})
