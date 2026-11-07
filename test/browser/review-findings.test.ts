/**
 * Findings of the independent whole-branch review (Stage 0 + A).
 * Ground truth is the browser itself: every case first proves via
 * getComputedStyle that the rule really applies (or applies in a state),
 * independent of the engine under test.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeSheet, collectSheets, type SelectorResult } from '../../src/index'

const RED = 'rgb(255, 0, 0)'
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function host(tag = 'div', parent: Node = document.body): { el: HTMLElement; shadow: ShadowRoot } {
  const el = document.createElement(tag)
  parent.appendChild(el)
  cleanups.push(() => el.remove())
  return { el, shadow: el.attachShadow({ mode: 'open' }) }
}

function sheet(css: string): CSSStyleSheet {
  const s = new CSSStyleSheet()
  s.replaceSync(css)
  return s
}

const color = (el: Element | null): string => (el ? getComputedStyle(el).color : 'missing')
const status = (results: SelectorResult[], needle: string): string | undefined =>
  results.find(r => r.selector.includes(needle))?.status

describe('review findings (fix pass)', () => {
  it('F1 a sheet adopted by two shadow roots is matched against both', () => {
    const shared = sheet('.only-in-two{color:red}')
    const one = host()
    const two = host()
    one.shadow.adoptedStyleSheets = [shared]
    two.shadow.adoptedStyleSheets = [shared]
    two.shadow.innerHTML = '<span class="only-in-two">x</span>'
    expect(color(two.shadow.querySelector('span'))).toBe(RED)
    const roots = collectSheets(document)
      .filter(e => e.sheet === shared)
      .map(e => e.root)
    expect(roots).toEqual([one.shadow, two.shadow])
  })

  it('F2 state inside :host(...) is neutralized', () => {
    const { el, shadow } = host()
    el.setAttribute('class', 'x')
    const s = sheet(':host(:hover){color:red} :host([open]){color:red}')
    shadow.adoptedStyleSheets = [s]
    el.setAttribute('open', '')
    expect(color(el)).toBe(RED) // [open] really styles the host
    el.removeAttribute('open')
    const results = analyzeSheet(s, { root: shadow })
    expect(status(results, ':hover')).toBe('state-dependent')
    expect(status(results, '[open]')).toBe('state-dependent')
  })

  it('F3 :host > .a .b checks the first compound after > for being a child', () => {
    const { shadow } = host()
    shadow.innerHTML = '<div class="a"><span class="b">x</span></div>'
    const s = sheet(':host > .a .b{color:red}')
    shadow.adoptedStyleSheets = [s]
    expect(color(shadow.querySelector('.b'))).toBe(RED)
    expect(analyzeSheet(s, { root: shadow })[0]?.status).toBe('used')
  })

  it('F4 @scope without prelude is not resolved against :root', () => {
    const wrap = document.createElement('div')
    wrap.innerHTML = '<style>@scope { :scope > .card{color:red} }</style><p class="card">x</p>'
    document.body.append(wrap)
    cleanups.push(() => wrap.remove())
    const style = wrap.querySelector('style')
    expect(color(wrap.querySelector('.card'))).toBe(RED)
    if (!style?.sheet) throw new Error('no sheet')
    expect(analyzeSheet(style.sheet)[0]?.status).toBe('used')
  })

  // Firefox and WebKit do not implement :host-context(); the rule never reaches the CSSOM there.
  it.runIf(CSS.supports('selector(:host-context(a))'))(
    'F5 :host-context() looks across shadow boundaries',
    () => {
      document.documentElement.classList.add('theme-dark')
      cleanups.push(() => document.documentElement.classList.remove('theme-dark'))
      const outer = host()
      const inner = host('div', outer.shadow)
      inner.shadow.innerHTML = '<span>x</span>'
      const s = sheet(':host-context(.theme-dark) span{color:red}')
      inner.shadow.adoptedStyleSheets = [s]
      expect(analyzeSheet(s, { root: inner.shadow })[0]?.status).toBe('used')
    },
  )

  it('F6 :scope inside @scope nested in a style rule', () => {
    const wrap = document.createElement('div')
    wrap.innerHTML =
      '<style>.a{ @scope (.b) { :scope > .c{color:red} } }</style><div class="a"><div class="b"><i class="c">x</i></div></div>'
    document.body.append(wrap)
    cleanups.push(() => wrap.remove())
    expect(color(wrap.querySelector('.c'))).toBe(RED)
    const style = wrap.querySelector('style')
    if (!style?.sheet) throw new Error('no sheet')
    expect(status(analyzeSheet(style.sheet), '.c')).toBe('used')
  })

  it('F7 :nth-child(… of S) neutralizes state classes in S', () => {
    const wrap = document.createElement('ul')
    wrap.innerHTML = '<li>1</li><li>2</li>'
    document.body.append(wrap)
    cleanups.push(() => wrap.remove())
    const s = sheet('li:nth-child(odd of .active){color:red}')
    expect(analyzeSheet(s)[0]?.status).toBe('state-dependent')
  })

  it('F8 :defined is runtime state (anti-flash rules are not unused)', () => {
    const el = document.createElement('div')
    document.body.append(el)
    cleanups.push(() => el.remove())
    const s = sheet('div:not(:defined){visibility:hidden}')
    expect(analyzeSheet(s)[0]?.status).toBe('state-dependent')
  })

  it('M1 :scope inside attribute strings is not rewritten', () => {
    const wrap = document.createElement('div')
    wrap.innerHTML =
      '<style>@scope (.c) { [data-x=":scope"]{color:red} }</style><div class="c"><i data-x=":scope">x</i></div>'
    document.body.append(wrap)
    cleanups.push(() => wrap.remove())
    expect(color(wrap.querySelector('i'))).toBe(RED)
    const style = wrap.querySelector('style')
    if (!style?.sheet) throw new Error('no sheet')
    expect(analyzeSheet(style.sheet)[0]?.status).toBe('used')
  })
})
