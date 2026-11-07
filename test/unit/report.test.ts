import { describe, expect, it } from 'vitest'
import {
  createState,
  type SelectorRecord,
  upsertRoute,
  upsertSelector,
} from '../../src/core/engine/state'
import { buildReport } from '../../src/core/report/build'
import { deletionPlan, remediation, toCsv, toMarkdown } from '../../src/core/report/exports'
import { parseReport } from '../../src/schema/report'

const CSS = 'https://app.test/app.css'

function state() {
  const s = createState()
  const add = (selector: string, patch: Partial<SelectorRecord> = {}) =>
    upsertSelector(s, {
      selector,
      context: '',
      status: 'unused',
      bytes: 100,
      sources: [CSS],
      routes: [],
      stale: false,
      ...patch,
    })
  add('.used', { status: 'used', routes: ['/'] })
  add('.dead-a')
  add('.dead-b')
  add('.legacy .dead-a') // shares class dead-a with an unused selector only
  add('.toggle', { status: 'state-dependent', routes: ['/'] })
  add('.js-only') // referenced from JS
  add('.half-used', { status: 'used', routes: ['/'] })
  add('.half-dead')
  add('.gone', { stale: true })
  add('.btn:not(.dead-b)', { status: 'used', routes: ['/'] }) // dead-b also guards a used rule
  s.sources.set(CSS, {
    key: CSS,
    href: CSS,
    kind: 'link',
    media: '',
    readable: true,
    serializedBytes: 1000,
    renderBlocking: true,
    framework: null,
  })
  upsertRoute(s, { key: '/', status: 'complete', visits: 2 })
  upsertRoute(s, { key: '/about', status: 'complete', visits: 1 })
  return s
}

const env = {
  version: '2.0.0',
  now: new Date('2026-11-07T00:00:00Z'),
  knownRoutes: ['/', '/about'],
  timings: new Map([[CSS, { decodedBytes: 2000, encodedBytes: 500, renderBlocking: true }]]),
  jsReferences: new Set(['js-only']),
  groups: new Map([
    ['\u0000.half-used', 'g1'],
    ['\u0000.half-dead', 'g1'],
  ]),
}

describe('buildReport', () => {
  const report = buildReport(state(), env)

  it('produces a schema-valid report v2', () => {
    expect(() => parseReport(report)).not.toThrow()
    expect(report.schema).toBe('css-coverage/v2')
  })

  it('counts statuses and keeps stale selectors out of the unused numbers', () => {
    expect(report.summary.selectors).toEqual({
      used: 3,
      unused: 5,
      'state-dependent': 1,
      print: 0,
      unknown: 0,
      stale: 1,
    })
  })

  it('scales unused bytes to the real file size and estimates gzip from transfer size', () => {
    const source = report.sources[0]
    // 5 unused × 100 serialized bytes of 1000 → 50 % of the 2000 decoded bytes
    expect(source?.unusedBytes).toBe(1000)
    expect(source?.unusedGzipBytes).toBe(250)
    expect(report.summary.unusedPercent).toBe(50)
  })

  it('computes route coverage against the inventory', () => {
    expect(report.coverage).toEqual({ visited: 2, known: 2, ratio: 1, allComplete: true })
  })

  it('rates deletion confidence: JS references lower it', () => {
    const conf = (selector: string) =>
      report.selectors.find(s => s.selector === selector)?.confidence
    expect(conf('.dead-a')).toBe('high')
    expect(conf('.js-only')).toBe('low')
    expect(conf('.used')).toBeNull()
  })

  it('is at most medium without a route inventory', () => {
    const noInventory = buildReport(state(), { ...env, knownRoutes: [] })
    expect(noInventory.selectors.find(s => s.selector === '.dead-a')?.confidence).toBe('medium')
    expect(noInventory.coverage.ratio).toBeNull()
  })
})

describe('exports', () => {
  const report = buildReport(state(), env)

  it('deletion plan separates whole rules, selectors in lists and state-dependent ones', () => {
    const plan = deletionPlan(report)[0]
    expect(plan?.source).toBe(CSS)
    expect(plan?.wholeRules.flat().map(s => s.selector)).toContain('.dead-a')
    expect(plan?.fromList.map(s => s.selector)).toEqual(['.half-dead'])
    expect(plan?.verify.map(s => s.selector)).toEqual(['.toggle'])
  })

  it('remediation lists only classes whose every selector is high-confidence unused', () => {
    const r = remediation(report)
    expect(r.classes).toEqual(['dead-a', 'half-dead', 'legacy'])
    expect(r.lightningcss).toEqual({ unusedSymbols: ['dead-a', 'half-dead', 'legacy'] })
    expect(r.tailwind).toBe(
      '@source not inline("dead-a");\n@source not inline("half-dead");\n@source not inline("legacy");\n',
    )
    expect(r.purgecss).toEqual({ blocklist: ['dead-a', 'half-dead', 'legacy'] })
  })

  it('CSV has a header and one line per selector, quoted safely', () => {
    const csv = toCsv(report).split('\n')
    expect(csv[0]).toBe(
      'selector,context,status,bytes,sources,routes,stale,confidence,referencedInJs',
    )
    expect(csv).toHaveLength(report.selectors.length + 1)
    const first = report.selectors[0]
    if (!first) throw new Error('report has no selectors')
    expect(toCsv({ ...report, selectors: [{ ...first, selector: 'a[x="1,2"]' }] })).toContain(
      '"a[x=""1,2""]"',
    )
  })

  it('Markdown lists the top files by unused KB', () => {
    const md = toMarkdown(report)
    expect(md).toContain('# CSS coverage report')
    expect(md).toContain('| https://app.test/app.css |')
    expect(md).toMatch(/Top files by unused/)
  })
})

describe('remediation never removes live CSS (review fix pass)', () => {
  function reportWith(
    records: Array<Partial<SelectorRecord> & { selector: string }>,
    atRules?: Parameters<typeof buildReport>[1]['atRules'],
  ) {
    const s = createState()
    for (const r of records) {
      upsertSelector(s, {
        context: '',
        status: 'unused',
        bytes: 10,
        sources: [CSS],
        routes: [],
        stale: false,
        ...r,
      })
    }
    upsertRoute(s, { key: '/', status: 'complete', visits: 1 })
    return buildReport(s, {
      version: 't',
      knownRoutes: ['/'],
      jsReferences: new Set(),
      ...(atRules ? { atRules } : {}),
    })
  }

  it('a name used as a live #id is not listed (Lightning CSS symbols are global)', () => {
    const r = reportWith([
      { selector: '#header', status: 'used', routes: ['/'] },
      { selector: '.header' },
    ])
    expect(remediation(r).classes).toEqual([])
  })

  it('names of used @keyframes and @counter-style are not listed', () => {
    const r = reportWith([{ selector: '.spin' }, { selector: '.thumbs' }, { selector: '.dead' }], {
      keyframes: [{ name: 'spin', source: CSS, used: true }],
      fontFaces: [],
      counterStyles: ['thumbs'],
    })
    expect(remediation(r).classes).toEqual(['dead'])
  })

  it('classes of stale selectors are treated as unsafe', () => {
    const r = reportWith([{ selector: '.btn', stale: true }, { selector: '.btn.big' }])
    expect(remediation(r).classes).toEqual(['big'])
  })
})
