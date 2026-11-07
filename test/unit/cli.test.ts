import { describe, expect, it } from 'vitest'
import { checkReport, diffReports, mergeReports, toHtml } from '../../src/cli/commands'
import {
  createState,
  type SelectorRecord,
  upsertRoute,
  upsertSelector,
} from '../../src/core/engine/state'
import { buildReport } from '../../src/core/report/build'
import type { Report } from '../../src/core/report/types'

const CSS = 'https://app.test/app.css'

function report(
  records: Array<Partial<SelectorRecord> & { selector: string }>,
  route: string,
): Report {
  const s = createState()
  for (const r of records) {
    upsertSelector(s, {
      context: '',
      status: 'unused',
      bytes: 100,
      sources: [CSS],
      routes: [],
      stale: false,
      ...r,
    })
  }
  s.sources.set(CSS, {
    key: CSS,
    href: CSS,
    kind: 'link',
    media: '',
    readable: true,
    serializedBytes: 400,
    renderBlocking: true,
    framework: null,
  })
  upsertRoute(s, { key: route, status: 'complete', visits: 1 })
  return buildReport(s, { version: 'test', knownRoutes: ['/', '/admin'], jsReferences: new Set() })
}

const runA = report(
  [
    { selector: '.home', status: 'used', routes: ['/'] },
    { selector: '.admin' },
    { selector: '.dead' },
    { selector: '.x' },
  ],
  '/',
)
const runB = report(
  [
    { selector: '.admin', status: 'used', routes: ['/admin'] },
    { selector: '.dead' },
    { selector: '.home' },
    { selector: '.x' },
  ],
  '/admin',
)

describe('mergeReports (runs, devs, viewports)', () => {
  const merged = mergeReports([runA, runB], { version: 'test' })

  it('takes the union: used anywhere → used', () => {
    const status = (s: string) => merged.selectors.find(x => x.selector === s)?.status
    expect(status('.home')).toBe('used')
    expect(status('.admin')).toBe('used')
    expect(status('.dead')).toBe('unused')
  })

  it('merges routes and recomputes coverage and confidence', () => {
    expect(merged.routes.map(r => r.route).sort()).toEqual(['/', '/admin'])
    expect(merged.coverage.ratio).toBe(1)
    expect(merged.selectors.find(x => x.selector === '.dead')?.confidence).toBe('high')
    expect(runA.selectors.find(x => x.selector === '.dead')?.confidence).toBe('medium')
  })
})

describe('diffReports', () => {
  it('shows removed selectors, newly unused selectors and bytes saved', () => {
    const before = report(
      [
        { selector: '.keep', status: 'used', routes: ['/'] },
        { selector: '.gone' },
        { selector: '.becomes-dead', status: 'used', routes: ['/'] },
      ],
      '/',
    )
    const after = report(
      [{ selector: '.keep', status: 'used', routes: ['/'] }, { selector: '.becomes-dead' }],
      '/',
    )
    const diff = diffReports(before, after)
    expect(diff.removedSelectors).toEqual(['.gone'])
    expect(diff.newlyUnused).toEqual(['.becomes-dead'])
  })
})

describe('checkReport (CI budget gate)', () => {
  it('fails when the unused budget is exceeded and passes otherwise', () => {
    const tight = checkReport(runA, { maxUnusedKb: 0.1 })
    expect(tight.ok).toBe(false)
    expect(tight.failures[0]).toMatch(/unused/i)
    expect(checkReport(runA, { maxUnusedKb: 100, maxUnusedPct: 100 }).ok).toBe(true)
  })

  it('--no-new-unused fails when a baseline selector became unused', () => {
    const before = report([{ selector: '.a', status: 'used', routes: ['/'] }], '/')
    const after = report([{ selector: '.a' }], '/')
    const result = checkReport(after, { baseline: before, noNewUnused: true })
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('.a')
  })

  it('enforces minimum route coverage', () => {
    expect(checkReport(runA, { minRouteCoverage: 0.9 }).ok).toBe(false)
  })
})

describe('toHtml', () => {
  it('renders a standalone, escaped HTML report', () => {
    const html = toHtml(report([{ selector: '.a<script>' }], '/'))
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('.a&lt;script&gt;')
    expect(html).not.toContain('.a<script>')
  })
})

describe('CDP coverage import (Playwright startCSSCoverage output)', () => {
  it('adds byte-exact unused bytes per stylesheet, matching URLs without cache busters', () => {
    const merged = mergeReports([runA], {
      version: 'test',
      cdp: [
        {
          url: `${CSS}?v=123`,
          text: 'x'.repeat(1000),
          ranges: [
            { start: 0, end: 300 },
            { start: 500, end: 600 },
          ],
        },
      ],
    })
    expect(merged.sources.find(s => s.key === CSS)?.cdpUnusedBytes).toBe(600)
  })
})

describe('merge order does not decide staleness (review fix pass)', () => {
  it('a selector is stale only when every run saw it stale', () => {
    const live = report(
      [{ selector: '.btn', status: 'used', routes: ['/'] }, { selector: '.btn.big' }],
      '/',
    )
    const stale = report(
      [{ selector: '.btn', status: 'used', routes: ['/'], stale: true }, { selector: '.btn.big' }],
      '/',
    )
    for (const order of [
      [live, stale],
      [stale, live],
    ]) {
      const merged = mergeReports(order, { version: 't' })
      expect(merged.selectors.find(s => s.selector === '.btn')?.stale).toBe(false)
    }
  })
})
