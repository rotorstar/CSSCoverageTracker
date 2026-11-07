import { describe, expect, it } from 'vitest'
import { requiredTokens } from '../../src/core/selector/required-tokens'

describe('requiredTokens (prefilter: tokens every match must have)', () => {
  it.each([
    ['.a .b > #c', { classes: ['a', 'b'], ids: ['c'], types: [], attributes: [] }],
    [
      'div.card[data-x="1"]',
      { classes: ['card'], ids: [], types: ['div'], attributes: ['data-x'] },
    ],
    ['.md\\:hover\\:x:hover', { classes: ['md:hover:x'], ids: [], types: [], attributes: [] }],
    [':is(.a, .b) .c', { classes: ['c'], ids: [], types: [], attributes: [] }],
    ['.x:not(.y):has(.z)', { classes: ['x'], ids: [], types: [], attributes: [] }],
    ['*', { classes: [], ids: [], types: [], attributes: [] }],
    ['SVG|Rect', { classes: [], ids: [], types: [], attributes: [] }],
    ['A.Btn', { classes: ['Btn'], ids: [], types: ['a'], attributes: [] }],
  ])('%s', (selector, expected) => {
    expect(requiredTokens(selector)).toEqual(expected)
  })

  it('returns null for :host selectors (they target the shadow host)', () => {
    expect(requiredTokens(':host(.x) .y')).toBeNull()
  })
})
