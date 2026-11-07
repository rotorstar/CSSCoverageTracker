/** Stage B acceptance tests (plan AC-B) against the public tracker API. */
import { afterEach, describe, expect, it } from 'vitest'
import { waitUntilActive } from '../../src/core/observe/lifecycle'
import { type CoverageTracker, createCoverageTracker } from '../../src/index'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

let counter = 0
function tracker(options: Parameters<typeof createCoverageTracker>[0] = {}): CoverageTracker {
  const t = createCoverageTracker({
    storageKey: `test-${Date.now()}-${counter++}`,
    navigation: 'manual',
    singleton: false,
    ui: false,
    force: true,
    ...options,
  })
  cleanups.push(() => t.stop())
  return t
}

function addStyle(css: string): HTMLStyleElement {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  cleanups.push(() => style.remove())
  return style
}

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  cleanups.push(() => root.remove())
  return root
}

const find = (t: CoverageTracker, selector: string) =>
  [...t.getState().selectors.values()].find(r => r.selector === selector)

describe('tracker (Stage B)', () => {
  it('attributes selectors to the routes they matched on', async () => {
    addStyle('.home{color:red}.admin-only{color:blue}.shared{color:green}')
    const root = mount('<div class="home shared"></div>')
    const t = tracker()
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    root.innerHTML = '<div class="admin-only shared"></div>'
    t.notifyNavigation('/admin')
    await t.idle()
    expect(find(t, '.admin-only')?.routes).toEqual(['/admin'])
    expect(find(t, '.home')?.routes).toEqual(['/'])
    expect(find(t, '.shared')?.routes.sort()).toEqual(['/', '/admin'])
    expect(t.getState().routes.get('/admin')?.status).toBe('complete')
  })

  it('re-checks after DOM mutations: an opened popover upgrades state-dependent → used', async () => {
    addStyle('.pop[data-state="open"]{opacity:1}')
    const root = mount('<div class="pop" data-state="closed"></div>')
    const t = tracker({ debounceMs: 10 })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    expect(find(t, '.pop[data-state="open"]')?.status).toBe('state-dependent')
    root.querySelector('.pop')?.setAttribute('data-state', 'open')
    await new Promise(r => setTimeout(r, 50))
    await t.idle()
    expect(find(t, '.pop[data-state="open"]')?.status).toBe('used')
  })

  it('marks rules deleted from a still-loaded source as stale, but not unloaded sources', async () => {
    const style = addStyle('.keep{color:red}.removed{color:blue}')
    style.id = 'hmr-style'
    const unloaded = addStyle('.chunk-only{color:green}')
    unloaded.id = 'route-chunk'
    mount('<i class="keep"></i>')
    const t = tracker()
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    style.textContent = '.keep{color:red}'
    unloaded.remove()
    await t.scan()
    expect(find(t, '.removed')?.stale).toBe(true)
    expect(find(t, '.chunk-only')?.stale).toBe(false)
    expect(find(t, '.keep')?.stale).toBe(false)
  })

  it('merges the coverage of two tabs (shared IndexedDB) into a union', async () => {
    const storageKey = `multi-${Date.now()}`
    addStyle('.tab-a{color:red}.tab-b{color:blue}')
    const root = mount('<i class="tab-a"></i>')
    const a = tracker({ storageKey })
    await a.start()
    a.notifyNavigation('/a')
    await a.idle()
    await a.flush()
    root.innerHTML = '<i class="tab-b"></i>'
    const b = tracker({ storageKey })
    await b.start()
    b.notifyNavigation('/b')
    await b.idle()
    await b.flush()
    const c = tracker({ storageKey })
    await c.start()
    expect(find(c, '.tab-a')?.status).toBe('used')
    expect(find(c, '.tab-b')?.status).toBe('used')
  })

  it('falls back to memory without throwing when IndexedDB fails (quota)', async () => {
    addStyle('.q{color:red}')
    const t = tracker({ storage: 'indexeddb', indexedDB: brokenIndexedDB() })
    await expect(t.start()).resolves.toBeUndefined()
    t.notifyNavigation('/')
    await t.idle()
    await expect(t.flush()).resolves.toBeUndefined()
    expect(t.storageWarning).toMatch(/memory/i)
  })

  it('never silently loses a short visit: the first route is kept as partial or complete', async () => {
    addStyle(Array.from({ length: 4000 }, (_, i) => `.s${i}{color:red}`).join(''))
    const t = tracker()
    await t.start()
    t.notifyNavigation('/short')
    t.notifyNavigation('/next')
    await t.idle()
    expect(['partial', 'complete']).toContain(t.getState().routes.get('/short')?.status)
    expect(t.getState().routes.get('/next')?.status).toBe('complete')
  })

  it('waits while the page is prerendering (no phantom routes)', async () => {
    const target = Object.assign(new EventTarget(), { prerendering: true })
    let active = false
    const waiting = waitUntilActive(target).then(() => {
      active = true
    })
    await new Promise(r => setTimeout(r, 10))
    expect(active).toBe(false)
    target.prerendering = false
    target.dispatchEvent(new Event('prerenderingchange'))
    await waiting
    expect(active).toBe(true)
  })

  it('resumes after a bfcache restore without double counting visits', async () => {
    addStyle('.bf{color:red}')
    mount('<i class="bf"></i>')
    const t = tracker()
    await t.start()
    t.notifyNavigation('/bf')
    await t.idle()
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await t.idle()
    expect(t.getState().routes.get('/bf')?.visits).toBe(1)
    expect(find(t, '.bf')?.status).toBe('used')
  })

  it('is a singleton per document unless disabled', () => {
    const a = createCoverageTracker({ force: true, ui: false, navigation: 'manual' })
    const b = createCoverageTracker({ force: true, ui: false, navigation: 'manual' })
    cleanups.push(() => a.stop())
    expect(a).toBe(b)
  })

  it('is a no-op in production unless forced', async () => {
    const t = createCoverageTracker({ ui: false, singleton: false, mode: 'production' })
    await t.start()
    expect(t.enabled).toBe(false)
  })
})

function brokenIndexedDB(): IDBFactory {
  return {
    open: () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    },
  } as unknown as IDBFactory
}

describe('tracker reacts to stylesheet changes (E2E findings)', () => {
  it('rescans when a <link> stylesheet finishes loading after start', async () => {
    const t = tracker({ debounceMs: 10 })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    const css = new Blob(['.late-linked{color:red}'], { type: 'text/css' })
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = URL.createObjectURL(css)
    const loaded = new Promise(r => link.addEventListener('load', r, { once: true }))
    document.head.append(link)
    cleanups.push(() => link.remove())
    await loaded
    await new Promise(r => setTimeout(r, 100))
    await t.idle()
    expect(find(t, '.late-linked')?.status).toBe('unused')
  })

  it('rescans when a <style> element gets new content (HMR) and marks removed rules stale', async () => {
    const style = addStyle('.hmr-a{color:red}.hmr-b{color:blue}')
    style.id = 'hmr'
    const t = tracker({ debounceMs: 10 })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    style.textContent = '.hmr-a{color:red}'
    await new Promise(r => setTimeout(r, 100))
    await t.idle()
    expect(find(t, '.hmr-b')?.stale).toBe(true)
  })

  it('configure() merges inventory options into a shared tracker', async () => {
    const t = tracker()
    await t.start()
    t.configure({ knownRoutes: ['/', '/x'] })
    t.notifyNavigation('/')
    await t.idle()
    expect((await t.getReport()).coverage.known).toBe(2)
  })
})

describe('start/stop race (React StrictMode double effects)', () => {
  it('a tracker stopped during start() never mounts its panel', async () => {
    const t = createCoverageTracker({
      storage: 'memory',
      navigation: 'manual',
      singleton: false,
      force: true,
    })
    const starting = t.start()
    t.stop()
    await starting
    await new Promise(r => setTimeout(r, 50))
    expect(document.querySelectorAll('css-coverage-panel')).toHaveLength(0)
  })
})

describe('review fix pass (Stage B–D)', () => {
  it('continuous DOM churn (animations) cannot starve re-checks: max wait for the debounce', async () => {
    addStyle('.pop[data-state="open"]{opacity:1}')
    const root = mount('<div class="pop" data-state="closed"></div><span class="tick">0</span>')
    const t = tracker({ debounceMs: 200 })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    let n = 0
    const timer = setInterval(() => {
      const tick = root.querySelector('.tick')
      if (tick) tick.textContent = String(++n)
      tick?.setAttribute('data-n', String(n))
    }, 40)
    cleanups.push(() => clearInterval(timer))
    root.querySelector('.pop')?.setAttribute('data-state', 'open')
    await new Promise(r => setTimeout(r, 1600))
    expect(find(t, '.pop[data-state="open"]')?.status).toBe('used')
    const started = performance.now()
    await t.idle()
    expect(performance.now() - started).toBeLessThan(2500)
  })

  it('adding a child re-checks selectors keyed on the parent (.stack > * + *)', async () => {
    addStyle('.stack > * + *{margin-top:8px}')
    const root = mount('<div class="stack"><p>a</p></div>')
    const t = tracker({ debounceMs: 10 })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    expect(find(t, '.stack > * + *')?.status).toBe('unused')
    root.querySelector('.stack')?.append(document.createElement('p'))
    await new Promise(r => setTimeout(r, 60))
    await t.idle()
    expect(find(t, '.stack > * + *')?.status).toBe('used')
  })

  it('work done while a save is in flight is not lost', async () => {
    addStyle('.late-arrival{color:red}')
    const t = tracker()
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    const saving = t.flush()
    mount('<i class="late-arrival"></i>')
    await t.scan()
    await saving
    expect(find(t, '.late-arrival')?.status).toBe('used')
  })

  it('stop() during start closes storage and never schedules a flush', async () => {
    const t = createCoverageTracker({
      storageKey: `stop-${Date.now()}`,
      navigation: 'manual',
      singleton: false,
      ui: false,
      force: true,
    })
    const starting = t.start()
    t.stop()
    await starting
    await new Promise(r => setTimeout(r, 400))
    expect(t.storageWarning).toBeNull()
  })
})

describe('states left by the next interaction are still observed', () => {
  it('pending re-checks run before a pointerdown changes the DOM again', async () => {
    addStyle('.menu[data-state="open"]{display:block}')
    const root = mount('<div class="menu" data-state="closed"></div>')
    const t = tracker({ debounceMs: 500 })
    await t.start()
    t.notifyNavigation('/')
    await t.idle()
    const menu = root.querySelector('.menu')
    menu?.setAttribute('data-state', 'open')
    await new Promise(r => setTimeout(r, 30)) // MutationObserver delivered, debounce still pending
    // the app closes the menu on the next pointerdown (outside click)
    const close = () => menu?.setAttribute('data-state', 'closed')
    document.addEventListener('pointerdown', close, { once: true })
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await t.idle()
    expect(find(t, '.menu[data-state="open"]')?.status).toBe('used')
  })
})
