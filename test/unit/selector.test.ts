import { describe, expect, it } from 'vitest'
import { isPrintOnly } from '../../src/core/collect/media'
import {
  DEFAULT_STATE,
  normalizeState,
  resolveNesting,
  resolveScope,
  toRawMatchable,
} from '../../src/core/selector/normalize'
import { splitSelectorList } from '../../src/core/selector/split-list'
import {
  SelectorSyntaxError,
  serializeTokens,
  tokenizeSelector,
} from '../../src/core/selector/tokenize'

describe('splitSelectorList', () => {
  it.each([
    ['.a, .b', ['.a', '.b']],
    [':is(.a, .b) .c, .d', [':is(.a, .b) .c', '.d']],
    ['.dark\\:bg-black:where(.dark, .dark *)', ['.dark\\:bg-black:where(.dark, .dark *)']],
    ['[data-x="a,b"], .e', ['[data-x="a,b"]', '.e']],
    ['.x\\,y, .z', ['.x\\,y', '.z']],
    [':not(:nth-child(2n+1)), .f', [':not(:nth-child(2n+1))', '.f']],
    ["[title='a,(b'], .g", ["[title='a,(b']", '.g']],
  ])('%s', (input, expected) => {
    expect(splitSelectorList(input)).toEqual(expected)
  })
})

describe('toRawMatchable (stage 1: only pseudo-elements removed)', () => {
  it.each([
    ['.card::before', '.card'],
    ['::selection', '*'],
    ['.a::-webkit-scrollbar-thumb:hover', '.a:hover'],
    ['my-el::part(label)', 'my-el'],
    ['.a ::slotted(.b)', '.a *'],
    ['::before > .x', '* > .x'],
    ['.clearfix:after', '.clearfix'],
    ['.x\\:\\:before', '.x\\:\\:before'],
    ['.card:focus-within', '.card:focus-within'],
  ])('%s → %s', (input, expected) => {
    expect(toRawMatchable(input)).toBe(expected)
  })
})

describe('normalizeState (stage 2: state pseudos, attributes and classes neutralized)', () => {
  it.each([
    ['.card:focus-within', '.card'],
    ['.focus-visible\\:outline:focus-visible', '.focus-visible\\:outline'],
    ['.md\\:hover\\:underline:hover', '.md\\:hover\\:underline'],
    [':hover', '*'],
    ['.a > :focus', '.a > *'],
    [':is(:where(.group):hover .x)', ':is(:where(.group) .x)'],
    ['.item:not(:nth-child(2n+1))', '.item:not(:nth-child(2n+1))'],
    ['.btn:not(:hover)', '.btn'],
    ['.tab:not(.active)', '.tab'],
    ['.card:has(.nope)', '.card:has(.nope)'],
    ['.form:has(:focus-visible)', '.form:has(*)'],
    ['.pop[data-state="open"]', '.pop'],
    ['.popup[data-open]', '.popup'],
    ['[data-state="open"]', '*'],
    ['.dropdown-menu.show', '.dropdown-menu'],
    ['.menu.is-active', '.menu'],
    ['.is-valid ~ .valid-feedback', '* ~ .valid-feedback'],
    ['.accordion-button:not(.collapsed)', '.accordion-button'],
    ['.x:is([open], :popover-open, :open)', '.x:is(*, *, *)'],
    [
      '.data-\\[state\\=open\\]\\:animate-in[data-state="open"]',
      '.data-\\[state\\=open\\]\\:animate-in',
    ],
    ['.item:nth-of-type(2)', '.item:nth-of-type(2)'],
    [':root .a', ':root .a'],
    ['a:any-link', 'a:any-link'],
    [':host(.x) .y', ':host(.x) .y'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeState(input)).toBe(expected)
  })
})

describe('resolveNesting', () => {
  it.each([
    ['& .title', '.card', ':is(.card) .title'],
    ['.x > & .y', '.a, .b', '.x > :is(.a, .b) .y'],
    ['&:hover', '.card', ':is(.card):hover'],
    ['.title', '.card', ':is(.card) .title'],
    ['[data-x="&"] &', '.card', '[data-x="&"] :is(.card)'],
  ])('%s in %s → %s', (selector, parent, expected) => {
    expect(resolveNesting(selector, parent)).toBe(expected)
  })
})

describe('isPrintOnly', () => {
  it.each([
    ['print', true],
    ['only print', true],
    ['PRINT', true],
    ['print and (orientation: landscape)', true],
    ['print, screen', false],
    ['screen', false],
    ['', false],
    ['not print', false],
    ['all', false],
  ])('%s → %s', (media, expected) => {
    expect(isPrintOnly(media)).toBe(expected)
  })
})

describe('state lists (every default entry is honoured)', () => {
  it.each(DEFAULT_STATE.attributes)('state attribute [%s] is neutralized', name => {
    expect(normalizeState(`.x[${name}]`)).toBe('.x')
    expect(normalizeState(`.x[${name}="v"]`)).toBe('.x')
  })

  it.each(DEFAULT_STATE.classes)('state class .%s is neutralized', name => {
    expect(normalizeState(`.x.${name}`)).toBe('.x')
  })

  it.each(DEFAULT_STATE.classPrefixes)('state class prefix %s* is neutralized', prefix => {
    expect(normalizeState(`.x.${prefix}thing`)).toBe('.x')
  })

  it('keeps attributes and classes that are not state', () => {
    expect(normalizeState('.x[data-variant="line"].card')).toBe('.x[data-variant="line"].card')
    expect(normalizeState('.this-is-not-state')).toBe('.this-is-not-state')
  })

  it.each([
    ':root',
    ':empty',
    ':first-child',
    ':last-child',
    ':only-child',
    ':first-of-type',
    ':last-of-type',
    ':only-of-type',
    ':nth-child(2)',
    ':nth-last-child(2)',
    ':nth-of-type(2)',
    ':nth-last-of-type(2)',
    ':scope',
    ':lang(de)',
    ':dir(rtl)',
    ':link',
    ':any-link',
    ':host',
    ':host-context(.dark)',
  ])('stable pseudo-class %s is kept', pseudo => {
    expect(normalizeState(`.x${pseudo}`)).toBe(`.x${pseudo}`)
  })

  it.each([
    ':hover',
    ':active',
    ':checked',
    ':disabled',
    ':target',
    ':user-invalid',
    ':-moz-focusring',
  ])('state or unknown pseudo-class %s is removed', pseudo => {
    expect(normalizeState(`.x${pseudo}`)).toBe('.x')
  })

  it.each([':matches(.a:hover)', ':-webkit-any(.a:hover)', ':-moz-any(.a:hover)'])(
    'legacy logical pseudo %s is normalized recursively',
    selector => {
      expect(normalizeState(selector)).toBe(selector.replace(':hover', ''))
    },
  )

  it('accepts a custom state configuration', () => {
    const state = { attributes: ['data-expanded'], classes: ['on'], classPrefixes: ['js-'] }
    expect(normalizeState('.x[data-expanded].on.js-open.show', state)).toBe('.x.show')
  })
})

describe('tokenizer edge cases', () => {
  it('unescapes hex and character escapes in class names', () => {
    expect(tokenizeSelector('.\\31 0').map(t => t.name)).toEqual(['10'])
    expect(tokenizeSelector('.md\\:hover').map(t => t.name)).toEqual(['md:hover'])
    expect(tokenizeSelector('.a\\1F600 b').map(t => t.name)).toEqual(['a😀b'])
  })

  it('reads namespaced type and attribute selectors', () => {
    expect(tokenizeSelector('svg|rect').map(t => [t.kind, t.name])).toEqual([['type', 'svg|rect']])
    expect(tokenizeSelector('*|*').map(t => t.kind)).toEqual(['type'])
    expect(tokenizeSelector('[xlink|href]').map(t => t.name)).toEqual(['href'])
    expect(tokenizeSelector('[lang|="en"]').map(t => t.name)).toEqual(['lang'])
  })

  it('normalizes combinators and surrounding whitespace', () => {
    expect(tokenizeSelector('  .a   >   .b  ~.c+.d .e ').map(t => t.text)).toEqual([
      '.a',
      '>',
      '.b',
      '~',
      '.c',
      '+',
      '.d',
      ' ',
      '.e',
    ])
    expect(serializeTokens(tokenizeSelector('.a>.b'))).toBe('.a > .b')
  })

  it.each(['.a[', ':is(.a', '.', '#', '.a)', '[x="a]', '.a ! .b'])(
    'rejects malformed selector %s',
    selector => {
      expect(() => tokenizeSelector(selector)).toThrow(SelectorSyntaxError)
    },
  )
})

describe('review-fix paths (unit level)', () => {
  it.each([
    [':host(:hover)', ':host(*)'],
    [':host([open])', ':host(*)'],
    [':host', ':host'],
    [':host-context(.dark:hover) .x', ':host-context(.dark) .x'],
    ['li:nth-child(odd of .active)', 'li:nth-child(odd of *)'],
    ['li:nth-last-child(2 of .item:hover)', 'li:nth-last-child(2 of .item)'],
    ['li:nth-child(2n+1)', 'li:nth-child(2n+1)'],
    ['x-e:not(:defined)', 'x-e'],
  ])('normalizeState(%s) → %s', (input, expected) => {
    expect(normalizeState(input)).toBe(expected)
  })

  it.each([
    ['.c', '.card', ':is(.card) .c'],
    [':scope > .c', '.card', ':is(.card) > .c'],
    ['& .t', '.card', ':is(.card) .t'],
    ['[data-x=":scope"]', '.c', ':is(.c) [data-x=":scope"]'],
    [':scope', '.a, .b', ':is(.a, .b)'],
    ['.x\\:scope .y', '.c', ':is(.c) .x\\:scope .y'],
  ])('resolveScope(%s, %s) → %s', (selector, start, expected) => {
    expect(resolveScope(selector, start)).toBe(expected)
  })
})
