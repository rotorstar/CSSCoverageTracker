import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { normalizeState, toRawMatchable } from '../../src/core/selector/normalize'
import { splitSelectorList } from '../../src/core/selector/split-list'
import { serializeTokens, tokenizeSelector } from '../../src/core/selector/tokenize'
import { selectorArbitrary } from '../harness/arbitraries'

const RUNS = Number(process.env.PROPERTY_RUNS ?? 10_000)
const canonical = (selector: string): string => serializeTokens(tokenizeSelector(selector))

describe('selector properties (fast-check, 10k runs each)', () => {
  it('round-trip: splitting a joined list returns the original selectors', () => {
    fc.assert(
      fc.property(fc.array(selectorArbitrary, { minLength: 1, maxLength: 4 }), selectors => {
        expect(splitSelectorList(selectors.join(', '))).toEqual(selectors.map(s => s.trim()))
      }),
      { numRuns: RUNS },
    )
  })

  it('tokenize → serialize reaches a fixpoint after one pass', () => {
    fc.assert(
      fc.property(selectorArbitrary, s => {
        expect(canonical(canonical(s))).toBe(canonical(s))
      }),
      { numRuns: RUNS },
    )
  })

  it('normalizeState is idempotent', () => {
    fc.assert(
      fc.property(selectorArbitrary, s => {
        expect(normalizeState(normalizeState(s))).toBe(normalizeState(s))
      }),
      { numRuns: RUNS },
    )
  })

  it('toRawMatchable is idempotent and removes every pseudo-element', () => {
    fc.assert(
      fc.property(selectorArbitrary, s => {
        const raw = toRawMatchable(s)
        expect(toRawMatchable(raw)).toBe(raw)
        expect(tokenizeSelector(raw).some(t => t.kind === 'pseudo-element')).toBe(false)
      }),
      { numRuns: RUNS },
    )
  })
})
