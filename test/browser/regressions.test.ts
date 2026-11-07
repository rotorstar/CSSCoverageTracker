/**
 * Regression tests for the findings of the v1 analysis (plan §1.2/§1.3).
 *
 * Every case reproduces a situation in which v1 reports live CSS as "unused"
 * (dangerous: users delete it) or never looks at a stylesheet at all.
 * Expected values follow the v2 status contract (plan §7):
 *   raw selector matches            → 'used'
 *   only the state-normalized form  → 'state-dependent'
 *   nothing matches                 → 'unused'
 *   print-only context              → 'print'
 */
import bootstrapCss from 'bootstrap/dist/css/bootstrap.css?raw'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeSheet, collectSheets, type SelectorResult } from '../../src/index'
import importedCssUrl from '../fixtures/css/imported.css?url'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  cleanups.push(() => host.remove())
  return host
}

function addStyle(css: string, media?: string): HTMLStyleElement {
  const style = document.createElement('style')
  if (media) style.media = media
  style.textContent = css
  document.head.append(style)
  cleanups.push(() => style.remove())
  return style
}

function sheetOf(style: HTMLStyleElement): CSSStyleSheet {
  if (!style.sheet) throw new Error('style element has no sheet')
  return style.sheet
}

function statuses(results: readonly SelectorResult[]): Array<[string, string]> {
  return results.map(result => [result.selector, result.status])
}

function find(results: readonly SelectorResult[], needle: string): SelectorResult | undefined {
  return results.find(result => result.selector.includes(needle))
}

function attachShadowHost(): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(() => host.remove())
  return { host, shadow: host.attachShadow({ mode: 'open' }) }
}

describe('v1 regressions: live CSS is never reported as unused', () => {
  it('R01 :focus-within is state-dependent, not unused', () => {
    mount('<div class="card"><h3 class="title">T</h3></div>')
    const results = analyzeSheet(sheetOf(addStyle('.card:focus-within{outline:1px solid}')))
    expect(statuses(results)).toEqual([['.card:focus-within', 'state-dependent']])
  })

  it('R02 Tailwind focus-visible: variant is state-dependent', () => {
    mount('<a class="focus-visible:outline" href="#x">x</a>')
    const results = analyzeSheet(
      sheetOf(addStyle('.focus-visible\\:outline:focus-visible{outline:auto}')),
    )
    expect(statuses(results)).toEqual([
      ['.focus-visible\\:outline:focus-visible', 'state-dependent'],
    ])
  })

  it('R03 Tailwind dark: variant (:where list) stays one selector and is used', () => {
    mount('<div class="dark"><div class="dark:bg-black">y</div></div>')
    const results = analyzeSheet(
      sheetOf(addStyle('.dark\\:bg-black:where(.dark, .dark *){background:black}')),
    )
    expect(statuses(results)).toEqual([['.dark\\:bg-black:where(.dark, .dark *)', 'used']])
  })

  it('R04 Tailwind stacked md:hover: variant keeps the escaped class intact', () => {
    mount('<span class="md:hover:underline">z</span>')
    const css =
      '@media (min-width: 48rem){@media (hover: hover){.md\\:hover\\:underline:hover{text-decoration:underline}}}'
    const results = analyzeSheet(sheetOf(addStyle(css)))
    expect(statuses(results)).toEqual([['.md\\:hover\\:underline:hover', 'state-dependent']])
  })

  it('R05 :is() selector list is not split at its inner comma', () => {
    mount('<div class="a"><div class="c"></div></div>')
    const results = analyzeSheet(sheetOf(addStyle(':is(.a, .b) .c{color:red}')))
    expect(statuses(results)).toEqual([[':is(.a, .b) .c', 'used']])
  })

  it('R06 nested parentheses in :not(:nth-child()) are handled', () => {
    mount('<ul><li class="item">1</li><li class="item">2</li><li class="item">3</li></ul>')
    const results = analyzeSheet(sheetOf(addStyle('.item:not(:nth-child(2n+1)){color:red}')))
    expect(statuses(results)).toEqual([['.item:not(:nth-child(2n+1))', 'used']])
  })

  it('R07 commas inside attribute values do not split the selector', () => {
    mount('<i data-x="a,b"></i>')
    const results = analyzeSheet(sheetOf(addStyle('[data-x="a,b"]{color:red}')))
    expect(statuses(results)).toEqual([['[data-x="a,b"]', 'used']])
  })

  it('R08 @media only print is print-only', () => {
    const results = analyzeSheet(sheetOf(addStyle('@media only print{.print-x{color:red}}')))
    expect(statuses(results)).toEqual([['.print-x', 'print']])
  })

  it('R09 a stylesheet with media="print" is print-only', () => {
    const results = analyzeSheet(sheetOf(addStyle('.print-sheet-x{color:red}', 'print')))
    expect(statuses(results)).toEqual([['.print-sheet-x', 'print']])
  })

  it('R10 shadcn data-[state=open]: variant on a closed component is state-dependent', () => {
    mount('<div class="data-[state=open]:animate-in" data-state="closed"></div>')
    const css = '.data-\\[state\\=open\\]\\:animate-in[data-state="open"]{animation:enter .15s}'
    const results = analyzeSheet(sheetOf(addStyle(css)))
    expect(statuses(results)).toEqual([
      ['.data-\\[state\\=open\\]\\:animate-in[data-state="open"]', 'state-dependent'],
    ])
  })

  it('R11 :has() with a missing child is unused (no false "used")', () => {
    mount('<div class="card"><h3 class="title">T</h3></div>')
    const results = analyzeSheet(sheetOf(addStyle('.card:has(.nope){color:red}')))
    expect(statuses(results)).toEqual([['.card:has(.nope)', 'unused']])
  })

  it('R12 elements of the tool UI do not make selectors used', () => {
    const ui = document.createElement('button')
    ui.dataset.cssCoverageUi = ''
    document.body.append(ui)
    cleanups.push(() => ui.remove())
    const results = analyzeSheet(sheetOf(addStyle('body > button{color:red}')), {
      exclude: element => element.closest('[data-css-coverage-ui]') !== null,
    })
    expect(statuses(results)).toEqual([['body > button', 'unused']])
  })

  it('R13 native CSS nesting: nested rules are extracted and resolved', () => {
    mount('<div class="card"><h3 class="title">T</h3></div>')
    const results = analyzeSheet(
      sheetOf(addStyle('.card{color:red; & .title{color:blue} .missing-nested{color:green}}')),
    )
    expect(results).toHaveLength(3)
    expect(find(results, '.title')?.status).toBe('used')
    expect(find(results, '.missing-nested')?.status).toBe('unused')
  })

  it('R14 rules from @import-ed stylesheets are analyzed', async () => {
    mount('<p class="imported-used">i</p>')
    const style = addStyle(`@import url("${importedCssUrl}");.host-rule{color:red}`)
    await new Promise(resolve => style.addEventListener('load', resolve, { once: true }))
    const results = analyzeSheet(sheetOf(style))
    expect(find(results, '.imported-used')?.status).toBe('used')
    expect(find(results, '.imported-unused')?.status).toBe('unused')
  })

  it('R15 collectSheets includes document.adoptedStyleSheets', () => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.adopted-x{color:red}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    cleanups.push(() => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet)
    })
    expect(collectSheets(document).some(e => e.sheet === sheet && e.root === document)).toBe(true)
  })

  it('R16 collectSheets includes stylesheets of open shadow roots', () => {
    const { shadow } = attachShadowHost()
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.in-shadow{color:red}')
    shadow.adoptedStyleSheets = [sheet]
    expect(collectSheets(document).some(e => e.sheet === sheet && e.root === shadow)).toBe(true)
  })

  it('R17 :host() selectors are evaluated against the shadow host', () => {
    const { host, shadow } = attachShadowHost()
    host.className = 'x'
    shadow.innerHTML = '<span class="y"></span>'
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(':host(.x) .y{color:red}')
    expect(statuses(analyzeSheet(sheet, { root: shadow }))).toEqual([[':host(.x) .y', 'used']])
  })

  it('R18 Bootstrap JS state class (.dropdown-menu.show) is state-dependent', () => {
    mount(
      '<div class="dropdown"><button class="btn dropdown-toggle" type="button">x</button>' +
        '<ul class="dropdown-menu"><li><a class="dropdown-item" href="#x">a</a></li></ul></div>',
    )
    const results = analyzeSheet(sheetOf(addStyle(bootstrapCss)))
    expect(results.find(r => r.selector === '.dropdown-menu.show')?.status).toBe('state-dependent')
  })

  it('R19 Base UI presence attribute [data-open] on a closed popup is state-dependent', () => {
    mount('<div class="popup" data-closed=""></div>')
    const results = analyzeSheet(sheetOf(addStyle('.popup[data-open]{opacity:1}')))
    expect(statuses(results)).toEqual([['.popup[data-open]', 'state-dependent']])
  })

  it('R20 JS-toggled .is-* state class is state-dependent', () => {
    mount('<nav class="menu"></nav>')
    const results = analyzeSheet(sheetOf(addStyle('.menu.is-active{display:block}')))
    expect(statuses(results)).toEqual([['.menu.is-active', 'state-dependent']])
  })
})

describe('controls: behaviour v1 already gets right (must stay green)', () => {
  it('C01 legacy :after is normalized by the CSSOM and counts as used', () => {
    mount('<div class="clearfix"></div>')
    const results = analyzeSheet(sheetOf(addStyle('.clearfix:after{content:""}')))
    expect(find(results, '.clearfix')?.status).toBe('used')
  })

  it('C02 plain class selectors: present → used, absent → unused', () => {
    mount('<div class="present"></div>')
    const results = analyzeSheet(sheetOf(addStyle('.present{color:red}.absent{color:blue}')))
    expect(statuses(results)).toEqual([
      ['.present', 'used'],
      ['.absent', 'unused'],
    ])
  })

  it('C03 rules inside @media print are print', () => {
    const results = analyzeSheet(sheetOf(addStyle('@media print{.only-print{color:red}}')))
    expect(statuses(results)).toEqual([['.only-print', 'print']])
  })

  it('C04 other media queries do not change the status', () => {
    mount('<div class="wide"></div>')
    const results = analyzeSheet(sheetOf(addStyle('@media (min-width: 1px){.wide{color:red}}')))
    expect(statuses(results)).toEqual([['.wide', 'used']])
  })
})
