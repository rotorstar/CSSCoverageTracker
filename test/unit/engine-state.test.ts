import { describe, expect, it } from 'vitest'
import {
  createState,
  fromPersisted,
  mergeStates,
  mergeStatus,
  type SelectorRecord,
  toPersisted,
  upsertSelector,
} from '../../src/core/engine/state'
import { defaultRouteKey } from '../../src/core/route/route-key'
import { migrateV1 } from '../../src/core/store/migrate-v1'

const record = (selector: string, patch: Partial<SelectorRecord> = {}): SelectorRecord => ({
  selector,
  context: '',
  status: 'unused',
  bytes: 10,
  sources: ['a.css'],
  routes: [],
  stale: false,
  ...patch,
})

describe('mergeStatus is monotonic: unused < unknown < state-dependent < used', () => {
  it.each([
    ['unused', 'used', 'used'],
    ['used', 'unused', 'used'],
    ['unused', 'state-dependent', 'state-dependent'],
    ['state-dependent', 'used', 'used'],
    ['unknown', 'unused', 'unknown'],
    ['unknown', 'state-dependent', 'state-dependent'],
    ['print', 'print', 'print'],
  ] as const)('%s + %s → %s', (a, b, expected) => {
    expect(mergeStatus(a, b)).toBe(expected)
  })
})

describe('coverage state', () => {
  it('upsert keeps the strongest status and unions sources and routes', () => {
    const state = createState()
    upsertSelector(state, record('.a', { routes: ['/'] }))
    upsertSelector(state, record('.a', { status: 'used', routes: ['/x'], sources: ['b.css'] }))
    const merged = state.selectors.get('\u0000.a')
    expect(merged?.status).toBe('used')
    expect(merged?.routes).toEqual(['/', '/x'])
    expect(merged?.sources).toEqual(['a.css', 'b.css'])
  })

  it('the newer observation decides "stale" (persisted older state must not keep it false)', () => {
    const persisted = createState()
    upsertSelector(persisted, record('.removed'))
    const current = createState()
    upsertSelector(current, record('.removed', { stale: true }))
    expect(mergeStates(persisted, current).selectors.get('\u0000.removed')?.stale).toBe(true)
    const revived = createState()
    upsertSelector(revived, record('.removed'))
    expect(mergeStates(current, revived).selectors.get('\u0000.removed')?.stale).toBe(false)
  })

  it('distinguishes the same selector in different contexts', () => {
    const state = createState()
    upsertSelector(state, record('.a'))
    upsertSelector(state, record('.a', { context: '@media print' }))
    expect(state.selectors.size).toBe(2)
  })

  it('merging two tabs gives the union (multi-tab, plan AC-B)', () => {
    const tabA = createState()
    const tabB = createState()
    upsertSelector(tabA, record('.only-a', { status: 'used', routes: ['/a'] }))
    upsertSelector(tabB, record('.only-b', { status: 'used', routes: ['/b'] }))
    upsertSelector(tabB, record('.only-a'))
    tabA.routes.set('/a', { key: '/a', status: 'complete', visits: 1 })
    tabB.routes.set('/b', { key: '/b', status: 'partial', visits: 2 })
    const merged = mergeStates(tabA, tabB)
    expect(merged.selectors.get('\u0000.only-a')?.status).toBe('used')
    expect(merged.selectors.get('\u0000.only-b')?.status).toBe('used')
    expect([...merged.routes.keys()].sort()).toEqual(['/a', '/b'])
  })

  it('a newer audit epoch replaces older data instead of merging', () => {
    const old = createState()
    upsertSelector(old, record('.old', { status: 'used' }))
    const fresh = createState(2)
    expect(mergeStates(old, fresh).selectors.size).toBe(0)
    expect(mergeStates(fresh, old).epoch).toBe(2)
  })

  it('persists compactly and round-trips losslessly', () => {
    const state = createState()
    for (let i = 0; i < 100; i++) {
      upsertSelector(
        state,
        record(`.u-${i}`, { sources: ['https://x.test/_next/static/css/app.css'], routes: ['/'] }),
      )
    }
    state.routes.set('/', { key: '/', status: 'complete', visits: 1 })
    const persisted = toPersisted(state)
    expect(fromPersisted(persisted)).toEqual(state)
    // v1 stored ~selector*2 + URL per entry; v2 interns sources and routes
    expect(JSON.stringify(persisted).length / 100).toBeLessThan(40)
  })
})

describe('defaultRouteKey', () => {
  it.each([
    ['https://x.test/', '/'],
    ['https://x.test/user/123', '/user/:id'],
    ['https://x.test/post/3f2a9c1e-0b5d-4c3a-9e1f-1a2b3c4d5e6f/edit', '/post/:id/edit'],
    ['https://x.test/commit/a1b2c3d4e5f60718', '/commit/:id'],
    ['https://x.test/blog/hello-world?page=2#top', '/blog/hello-world'],
    ['https://x.test/docs/', '/docs'],
  ])('%s → %s', (url, expected) => {
    expect(defaultRouteKey(new URL(url))).toBe(expected)
  })

  it('can keep query and hash when asked', () => {
    expect(defaultRouteKey(new URL('https://x.test/a?tab=b#c'), { search: true, hash: true })).toBe(
      '/a?tab=b#c',
    )
  })
})

describe('migrateV1', () => {
  it('converts the v1 localStorage format', () => {
    const state = migrateV1({
      selectors: {
        '.a': { selector: '.a', matched: true, printOnly: false, source: 'x.css' },
        '.b': { selector: '.b', matched: false, printOnly: false, source: 'x.css' },
        '.p': { selector: '.p', matched: false, printOnly: true, source: 'p.css' },
      },
      pages: ['/', '/about'],
      lastScan: 1,
    })
    expect(state?.selectors.get('\u0000.a')?.status).toBe('used')
    expect(state?.selectors.get('\u0000.b')?.status).toBe('unused')
    expect(state?.selectors.get('\u0000.p')?.status).toBe('print')
    expect(state?.routes.get('/about')?.status).toBe('partial')
  })

  it.each([null, 42, 'x', { selectors: 1 }, { selectors: {}, pages: 'x' }])(
    'rejects invalid v1 data %j',
    value => {
      expect(migrateV1(value)).toBeNull()
    },
  )
})
