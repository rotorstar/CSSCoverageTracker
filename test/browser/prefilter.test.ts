import bootstrapCss from 'bootstrap/dist/css/bootstrap.css?raw'
import { afterEach, describe, expect, it } from 'vitest'
import { walkSheet } from '../../src/core/collect/walk-cssom'
import { DomIndex } from '../../src/core/match/dom-index'
import { classifySelector } from '../../src/core/match/matcher'
import tailwindCss from '../fixtures/tailwind/output.css?raw'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function addSheet(css: string): CSSStyleSheet {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  cleanups.push(() => style.remove())
  if (!style.sheet) throw new Error('no sheet')
  return style.sheet
}

describe('DomIndex prefilter', () => {
  it('produces exactly the same statuses as unfiltered matching on real CSS', () => {
    const root = document.createElement('div')
    root.innerHTML = `<nav class="navbar navbar-expand-lg"><a class="nav-link active" href="#a">x</a>
      <ul class="dropdown-menu"><li><a class="dropdown-item" href="#a">a</a></li></ul></nav>
      <div class="card"><div class="card-body"><h5 class="card-title">T</h5><button class="btn btn-primary" disabled>b</button></div></div>
      <div data-state="closed" class="bg-popover rounded-md border p-4 data-[state=open]:animate-in"></div>
      <input class="form-control" data-slot="input" aria-invalid="true">`
    document.body.append(root)
    cleanups.push(() => root.remove())
    const index = DomIndex.build(document)
    const selectors = [bootstrapCss, tailwindCss].flatMap(css => walkSheet(addSheet(css), 'x'))
    const mismatches = selectors.filter(({ selector, print }) => {
      const plain = classifySelector(selector, print, { root: document })
      const filtered = classifySelector(selector, print, { root: document, index })
      return plain !== filtered
    })
    expect(selectors.length).toBeGreaterThan(3000)
    expect(mismatches.map(m => m.selector)).toEqual([])
  })

  it('learns tokens of nodes added later', () => {
    const index = DomIndex.build(document)
    expect(index.has({ classes: ['late-class'], ids: [], types: [], attributes: [] })).toBe(false)
    const el = document.createElement('section')
    el.innerHTML = '<i class="late-class" data-late></i>'
    document.body.append(el)
    cleanups.push(() => el.remove())
    const tokens = index.add(el)
    expect(tokens).toContain('.late-class')
    expect(
      index.has({ classes: ['late-class'], ids: [], types: ['i'], attributes: ['data-late'] }),
    ).toBe(true)
  })
})
