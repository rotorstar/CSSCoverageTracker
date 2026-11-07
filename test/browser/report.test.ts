import { afterEach, describe, expect, inject, it } from 'vitest'
import { createCoverageTracker } from '../../src/index'
import linkedUrl from '../fixtures/css/linked.css?url'
import sitemapUrl from '../fixtures/sitemap.xml?url'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function addLink(href: string): Promise<HTMLLinkElement> {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.append(link)
  cleanups.push(() => link.remove())
  return new Promise(resolve => {
    link.onload = () => resolve(link)
    link.onerror = () => resolve(link)
  })
}

function tracker(options: Parameters<typeof createCoverageTracker>[0] = {}) {
  const t = createCoverageTracker({
    storage: 'memory',
    navigation: 'manual',
    singleton: false,
    ui: false,
    force: true,
    ...options,
  })
  cleanups.push(() => t.stop())
  return t
}

describe('report v2 from a live page', () => {
  it('measures file bytes, groups, JS references and route inventory', async () => {
    await addLink(linkedUrl)
    const root = document.createElement('div')
    root.innerHTML = '<i class="linked-used"></i><i class="linked-used-too"></i>'
    const script = document.createElement('script')
    script.textContent = 'window.__toggle = () => document.body.classList.add("js-toggled")'
    document.body.append(root, script)
    cleanups.push(() => {
      root.remove()
      script.remove()
    })
    const t = tracker({ sitemap: sitemapUrl, knownRoutes: ['/docs'] })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    const report = await t.getReport()

    const source = report.sources.find(s => s.href?.includes('linked.css'))
    expect(source?.decodedBytes).toBeGreaterThan(0)
    expect(source?.unusedBytes).toBeGreaterThan(0)
    expect(source?.unusedGzipBytes).toBeGreaterThan(0)

    const find = (selector: string) => report.selectors.find(s => s.selector === selector)
    expect(find('.linked-dead-a')?.group).toBe(find('.linked-used-too')?.group)
    expect(find(`.${['linked', 'dead', 'b'].join('-')}`)?.group).not.toBe(
      find('.linked-dead-a')?.group,
    )
    expect(find('.js-toggled')?.referencedInJs).toBe(true)
    expect(find('.js-toggled')?.confidence).toBe('low')
    // built dynamically: this test file is itself a same-origin script
    expect(find(`.${['linked', 'dead', 'b'].join('-')}`)?.referencedInJs).toBe(false)

    expect(report.knownRoutes.sort()).toEqual(['/', '/docs', '/pricing', '/user/:id'])
    expect(report.coverage.ratio).toBe(0.25)
  })

  it('lists unreadable cross-origin sheets and analyzes them when fetchCrossOrigin is on', async () => {
    const crossOrigin = new URL('/linked.css', inject('crossOrigin'))
    await addLink(crossOrigin.href)
    const plain = tracker()
    await plain.start()
    plain.notifyNavigation('/')
    await plain.idle()
    const before = await plain.getReport()
    expect(before.sources.find(s => s.href === crossOrigin.href)?.readable).toBe(false)
    expect(before.warnings.join(' ')).toMatch(/CORS/)

    const fetching = tracker({ fetchCrossOrigin: true })
    await fetching.start()
    fetching.notifyNavigation('/')
    await fetching.idle()
    await new Promise(r => setTimeout(r, 300))
    await fetching.idle()
    const after = await fetching.getReport()
    const source = after.sources.find(s => s.key === crossOrigin.href)
    expect(source?.kind).toBe('fetched')
    expect(after.selectors.some(s => s.selector === `.${['linked', 'dead', 'b'].join('-')}`)).toBe(
      true,
    )
  })
})
