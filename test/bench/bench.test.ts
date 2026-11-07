/** Performance acceptance (plan AC-B, M3/M4). Runs where Long Tasks/LoAF are observable (Chromium). */
import fontAwesomeCss from '@fortawesome/fontawesome-free/css/all.css?raw'
import bootstrapCss from 'bootstrap/dist/css/bootstrap.css?raw'
import { afterEach, describe, expect, it } from 'vitest'
import { walkSheet } from '../../src/core/collect/walk-cssom'
import { toPersisted } from '../../src/core/engine/state'
import { createCoverageTracker } from '../../src/index'
import tailwindCss from '../fixtures/tailwind/output.css?raw'
import { v1Scan, v1StorageSize } from '../harness/v1-scan'

const observable = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function addStyle(css: string): CSSStyleSheet {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  cleanups.push(() => style.remove())
  if (!style.sheet) throw new Error('no sheet')
  return style.sheet
}

/** Real CSS, scoped copies of Bootstrap to reach legacy-app size. */
function realCss(): string {
  const scoped = (prefix: string) =>
    bootstrapCss.replace(/(^|[},])\s*\.(?=[a-z])/g, `$1 .${prefix}-`)
  return [
    bootstrapCss,
    fontAwesomeCss,
    tailwindCss,
    scoped('legacy'),
    scoped('old'),
    scoped('archive'),
    scoped('v3'),
  ].join('\n')
}

describe.runIf(observable)('performance (Chromium)', () => {
  it('scans ≥ 15k real selectors on a ≥ 9k-node DOM without long frames, ≥ 4× faster than v1', async () => {
    const sheet = addStyle(realCss())
    const selectors = walkSheet(sheet, 'bench').map(w => w.selector)
    const root = document.createElement('div')
    root.innerHTML = Array.from(
      { length: 320 },
      (_, i) =>
        `<div class="card mb-${i % 5}"><div class="card-body"><h5 class="card-title">t</h5><p class="card-text text-muted">x</p><a class="btn btn-primary" href="#a">b</a><span class="badge text-bg-info">1</span><i class="fa-solid fa-user"></i></div><ul class="list-group"><li class="list-group-item">a</li><li class="list-group-item">b</li></ul><div><p>a</p><p>b</p><p>c</p><p>d</p><p>e</p><p>f</p><p>g</p><p>h</p><p>i</p><p>j</p><p>k</p><p>l</p><p>m</p><p>n</p><p>o</p><p>p</p><p>q</p><p>r</p></div></div>`,
    ).join('')
    document.body.append(root)
    cleanups.push(() => root.remove())
    const nodes = document.getElementsByTagName('*').length
    expect(selectors.length).toBeGreaterThanOrEqual(15_000)
    expect(nodes).toBeGreaterThanOrEqual(9_000)

    const v1Start = performance.now()
    v1Scan(selectors)
    const v1Ms = performance.now() - v1Start

    const frames: PerformanceEntry[] = []
    const observer = new PerformanceObserver(list => frames.push(...list.getEntries()))
    observer.observe({ type: 'long-animation-frame' })
    const tracker = createCoverageTracker({
      storage: 'memory',
      navigation: 'manual',
      singleton: false,
      ui: false,
      force: true,
    })
    cleanups.push(() => tracker.stop())
    await tracker.start()
    const coldStart = performance.now()
    tracker.notifyNavigation('/first')
    await tracker.idle() // includes deferred byte accounting, which must not cause long frames either
    const coldMs = performance.now() - coldStart
    // end the frame before the first blocking v1 run (see the loop below)
    await new Promise(r => setTimeout(r, 60))

    // per-navigation cost on the next route (what users pay on every client-side navigation);
    // medians of 5 runs keep shared CI machines from deciding the result
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
    const v1Runs: number[] = []
    const wallRuns: number[] = []
    const busyRuns: number[] = []
    const v2Windows: Array<[number, number]> = []
    for (let i = 0; i < 5; i++) {
      const v1Start = performance.now()
      v1Scan(selectors) // blocks by design; excluded from the long-frame check below
      v1Runs.push(performance.now() - v1Start)
      await new Promise(r => setTimeout(r, 50))
      const start = performance.now()
      tracker.notifyNavigation(`/route-${i}`)
      await tracker.idle()
      wallRuns.push(performance.now() - start)
      v2Windows.push([start, performance.now()])
      // let the frame end before the next blocking v1 run, so its long frame is not
      // attributed to the tracker's last continuation
      await new Promise(r => setTimeout(r, 60))
      busyRuns.push(tracker.lastPass?.busyMs ?? Number.POSITIVE_INFINITY)
    }
    const v1Ms2 = median(v1Runs)
    const v2Ms = median(wallRuns)
    await new Promise(r => setTimeout(r, 100))
    observer.disconnect()

    // long frames that overlap the tracker's own work (cold pass + next-route passes)
    const windows: Array<[number, number]> = [[coldStart, coldStart + coldMs], ...v2Windows]
    const longFrames = frames.filter(
      f =>
        f.duration > 50 &&
        windows.some(([a, b]) => f.startTime < b && f.startTime + f.duration > a),
    )
    const busyMs = median(busyRuns)
    console.info(
      `bench: selectors=${selectors.length} nodes=${nodes} v1=${v1Ms.toFixed(0)}/${v1Ms2.toFixed(0)}ms (blocking) ` +
        `v2 cold=${coldMs.toFixed(0)}ms next-route wall=${v2Ms.toFixed(0)}ms busy=${busyMs.toFixed(0)}ms longFrames=${longFrames.length}`,
    )
    expect(longFrames).toEqual([])
    // main-thread work per navigation: v1 blocks for its whole scan, v2 works in ≤ 8 ms slices
    expect(v1Ms2 / busyMs).toBeGreaterThanOrEqual(4)

    // M4: persisted state ≤ 25 % of the v1 localStorage payload for the same data
    const persisted = JSON.stringify(toPersisted(tracker.getState())).length
    const v1 = v1StorageSize(
      selectors,
      'http://localhost:3000/_next/static/css/app/layout.css?v=1762412345678',
    )
    console.info(`storage: v2=${persisted} v1=${v1} ratio=${(persisted / v1).toFixed(2)}`)
    expect(persisted / v1).toBeLessThanOrEqual(0.25)
  })
})
