import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CSSCoverageTracker, routePattern } from '../../src/react/index'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function render(): { root: Root; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return { root, container }
}

const tracker = () => Reflect.get(globalThis, Symbol.for('css-coverage-tracker'))
// idle() covers boot (store load, panel mount) and the pass the adapter started
const settle = (): Promise<void> => tracker().idle()

describe('React adapter', () => {
  it('starts the shared tracker, migrates v1 data and follows the pathname prop', async () => {
    const key = `react-${Date.now()}`
    localStorage.setItem(
      key,
      JSON.stringify({
        selectors: {
          '.legacy': { selector: '.legacy', matched: true, printOnly: false, source: 'x.css' },
        },
        pages: ['/old'],
        lastScan: 1,
      }),
    )
    cleanups.push(() => localStorage.removeItem(key))
    const { root } = render()
    await act(async () => {
      root.render(
        <CSSCoverageTracker
          pathname="/a"
          config={{ storageKey: key, position: 'top-right' }}
          options={{ force: true }}
        />,
      )
    })
    await settle()
    expect(document.querySelector('css-coverage-panel')).not.toBeNull()
    const state = tracker().getState()
    expect(state.selectors.get('\u0000.legacy')?.status).toBe('used')
    expect(state.routes.has('/a')).toBe(true)
    await act(async () => {
      root.render(
        <CSSCoverageTracker
          pathname="/b"
          route="/blog/[slug]"
          config={{ storageKey: key }}
          options={{ force: true }}
        />,
      )
    })
    await settle()
    expect(tracker().getState().routes.has('/blog/[slug]')).toBe(true)
  })

  it('removes the panel and the singleton on unmount', async () => {
    const { root } = render()
    await act(async () => {
      root.render(
        <CSSCoverageTracker options={{ force: true, storage: 'memory', navigation: 'manual' }} />,
      )
    })
    await settle()
    expect(document.querySelector('css-coverage-panel')).not.toBeNull()
    act(() => root.unmount())
    expect(document.querySelector('css-coverage-panel')).toBeNull()
    expect(tracker()).toBeUndefined()
  })

  it('routePattern turns params into a route pattern', () => {
    expect(routePattern('/blog/hello-world', { slug: 'hello-world' })).toBe('/blog/[slug]')
    expect(routePattern('/docs/a/b', { path: ['a', 'b'] })).toBe('/docs/[...path]')
  })
})
