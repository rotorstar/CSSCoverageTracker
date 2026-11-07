/** fast-check arbitraries for CSS selectors with the hard parts: escapes, strings, nesting. */
import fc from 'fast-check'

const CLASS_NAMES = [
  'card',
  'btn',
  'title',
  'item',
  'md\\:hover\\:x',
  'data-\\[state\\=open\\]\\:in',
  'w-1\\/2',
]

const ident = fc.constantFrom(...CLASS_NAMES)
const attribute = fc.constantFrom(
  '[data-x]',
  '[data-x="a,b"]',
  "[title='(x,']",
  '[data-state="open"]',
  '[data-open]',
  '[aria-expanded="true"]',
)
const pseudoClass = fc.constantFrom(
  ':hover',
  ':focus-visible',
  ':first-child',
  ':nth-child(2n+1)',
  ':empty',
)
const pseudoElement = fc.constantFrom('::before', '::after', '::placeholder')
const combinator = fc.constantFrom(' ', ' > ', ' + ', ' ~ ')

const { selector } = fc.letrec<{ simple: string; compound: string; selector: string }>(tie => ({
  simple: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    ident.map(name => `.${name}`),
    attribute,
    pseudoClass,
    fc.constantFrom('.show', '.is-active', '#main'),
    tie('selector').map(inner => `:is(${inner}, .item)`),
    tie('selector').map(inner => `:not(${inner})`),
    tie('selector').map(inner => `:where(${inner})`),
    ident.map(name => `:has(> .${name})`),
  ),
  compound: fc
    .tuple(
      fc.constantFrom('', 'div', 'a', '*'),
      fc.array(tie('simple'), { minLength: 1, maxLength: 3 }),
    )
    .map(([type, simples]) => `${type}${simples.join('')}`),
  selector: fc
    .tuple(tie('compound'), fc.array(fc.tuple(combinator, tie('compound')), { maxLength: 2 }))
    .map(([first, rest]) => first + rest.map(([c, part]) => c + part).join('')),
}))

/**
 * A single complex selector (no top-level commas). Pseudo-elements only appear
 * at the end of the outermost compound, as CSS requires.
 */
export const selectorArbitrary: fc.Arbitrary<string> = fc
  .tuple(selector, fc.option(pseudoElement, { nil: '' }))
  .map(([complex, element]) => complex + element)

export const DOM_FIXTURE: string = `
<div class="card" data-x="a,b" title="(x,"><a class="btn md:hover:x" data-state="closed" href="#a">x</a>
<span class="title"></span><span class="item w-1/2"></span><div class="item data-[state=open]:in"></div></div>`
