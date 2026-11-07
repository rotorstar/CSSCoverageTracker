/**
 * Differential + property tests in real engines (plan AC-A, F3):
 * - our list splitter and class tokenizer agree with postcss-selector-parser
 *   on every selector of the real-CSS corpus;
 * - stage 2 is monotonic: whenever the raw selector matches, the normalized
 *   one matches too (it only ever broadens).
 */
import fontAwesomeCss from '@fortawesome/fontawesome-free/css/all.css?raw'
import bootstrapCss from 'bootstrap/dist/css/bootstrap.css?raw'
import fc from 'fast-check'
import parser from 'postcss-selector-parser'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeState, toRawMatchable } from '../../src/core/selector/normalize'
import { splitSelectorList } from '../../src/core/selector/split-list'
import { tokenizeSelector } from '../../src/core/selector/tokenize'
import tailwindCss from '../fixtures/tailwind/output.css?raw'
import { DOM_FIXTURE, selectorArbitrary } from '../harness/arbitraries'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** selectorText of every style rule (top level and nested) of a CSS text. */
function selectorTexts(css: string): string[] {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  cleanups.push(() => style.remove())
  const out: string[] = []
  const walk = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) out.push(rule.selectorText)
      if (rule instanceof CSSGroupingRule) walk(rule.cssRules)
    }
  }
  if (style.sheet) walk(style.sheet.cssRules)
  return out
}

/** Classes of the top-level compounds (outside functional pseudos), per postcss-selector-parser. */
function referenceClasses(selector: string): string[] {
  const classes: string[] = []
  parser(root => {
    for (const node of root.first.nodes) if (node.type === 'class') classes.push(node.value)
  }).processSync(selector)
  return classes
}

describe('differential: splitter and tokenizer vs postcss-selector-parser', () => {
  it('agrees on every selector list of Bootstrap, Tailwind/shadcn and Font Awesome', () => {
    const lists = [bootstrapCss, tailwindCss, fontAwesomeCss].flatMap(selectorTexts)
    const mismatches: string[] = []
    for (const list of lists) {
      const ours = splitSelectorList(list)
      const reference = parser()
        .astSync(list)
        .nodes.map(node => String(node).trim())
      if (JSON.stringify(ours) !== JSON.stringify(reference)) {
        mismatches.push(`split ${list}`)
        continue
      }
      for (const selector of ours) {
        const classes = tokenizeSelector(selector)
          .filter(token => token.kind === 'class')
          .map(token => token.name)
        if (JSON.stringify(classes) !== JSON.stringify(referenceClasses(selector))) {
          mismatches.push(`classes ${selector}`)
        }
      }
    }
    expect(lists.length).toBeGreaterThan(3000)
    expect(mismatches).toEqual([])
  })
})

describe('property: stage 2 only broadens (monotonic)', () => {
  it('normalized selector matches whenever the raw selector matches', () => {
    const host = document.createElement('div')
    host.innerHTML = DOM_FIXTURE
    document.body.append(host)
    cleanups.push(() => host.remove())
    fc.assert(
      fc.property(selectorArbitrary, selector => {
        const raw = toRawMatchable(selector)
        if (host.querySelector(raw) !== null) {
          expect(host.querySelector(normalizeState(selector))).not.toBeNull()
        }
      }),
      { numRuns: 2_000 },
    )
  })
})
