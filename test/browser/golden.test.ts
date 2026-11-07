/**
 * Golden corpus (plan AC-A): real CSS (Bootstrap 5.3.8, Tailwind 4.3.5 build of
 * shadcn/ui sources, Font Awesome 7.3.1) against real component markup.
 *
 * Oracle: components are rendered in their closed/idle state, then switched
 * into their runtime states (open, active, checked, validated, …). Every
 * selector that matches as written in ANY state is live CSS, so in the idle
 * DOM it must never be classified `unused`.
 */

import fontAwesomeCss from '@fortawesome/fontawesome-free/css/all.css?raw'
import bootstrapCss from 'bootstrap/dist/css/bootstrap.css?raw'
import { afterEach, describe, expect, it } from 'vitest'
import { walkSheet } from '../../src/core/collect/walk-cssom'
import { normalizeState, toRawMatchable } from '../../src/core/selector/normalize'
import { analyzeSheet } from '../../src/index'
import tailwindCss from '../fixtures/tailwind/output.css?raw'

const shadcnSources = Object.values(
  import.meta.glob<string>('../fixtures/tailwind/sources/*.tsx.txt', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)

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

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  cleanups.push(() => root.remove())
  return root
}

/** Selectors that match as written (stage 1) in the current DOM. */
function liveSelectors(sheet: CSSStyleSheet): Set<string> {
  return new Set(
    analyzeSheet(sheet)
      .filter(result => result.status === 'used')
      .map(result => result.selector),
  )
}

/** Runs the oracle and returns the selectors that would be wrongly reported as unused. */
function falseUnused(
  sheet: CSSStyleSheet,
  root: HTMLElement,
  idleHtml: string,
  states: Array<(root: HTMLElement) => void>,
): { live: number; wrong: string[] } {
  const live = new Set<string>()
  for (const applyState of states) {
    root.innerHTML = idleHtml
    applyState(root)
    for (const selector of liveSelectors(sheet)) live.add(selector)
  }
  root.innerHTML = idleHtml
  const wrong = analyzeSheet(sheet)
    .filter(result => result.status === 'unused' && live.has(result.selector))
    .map(result => result.selector)
  return { live: live.size, wrong }
}

const BOOTSTRAP_IDLE = `
<nav class="navbar navbar-expand-lg bg-body-tertiary"><div class="container-fluid">
  <a class="navbar-brand" href="#a">Brand</a>
  <button class="navbar-toggler collapsed" type="button" data-bs-toggle="collapse" aria-expanded="false"><span class="navbar-toggler-icon"></span></button>
  <div class="collapse navbar-collapse"><ul class="navbar-nav me-auto">
    <li class="nav-item"><a class="nav-link" href="#a">Home</a></li>
    <li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#a" role="button" aria-expanded="false">More</a>
      <ul class="dropdown-menu"><li><a class="dropdown-item" href="#a">Action</a></li><li><hr class="dropdown-divider"></li></ul></li>
  </ul></div></div></nav>
<ul class="nav nav-tabs"><li class="nav-item"><button class="nav-link" type="button">One</button></li><li class="nav-item"><button class="nav-link" type="button">Two</button></li></ul>
<div class="tab-content"><div class="tab-pane fade">A</div><div class="tab-pane fade">B</div></div>
<div class="accordion"><div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button collapsed" type="button" aria-expanded="false">Q</button></h2>
  <div class="accordion-collapse collapse"><div class="accordion-body">A</div></div></div></div>
<div class="alert alert-warning alert-dismissible fade" role="alert">Hi<button type="button" class="btn-close"></button></div>
<div class="modal fade" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">T</h5></div><div class="modal-body">B</div></div></div></div>
<div class="modal-backdrop fade"></div>
<div class="toast"><div class="toast-header">T</div><div class="toast-body">B</div></div>
<div class="offcanvas offcanvas-start"><div class="offcanvas-body">O</div></div>
<div class="list-group"><a href="#a" class="list-group-item list-group-item-action">1</a><a href="#a" class="list-group-item list-group-item-action">2</a></div>
<div class="carousel slide"><div class="carousel-inner"><div class="carousel-item">1</div><div class="carousel-item">2</div></div></div>
<form class="needs-validation"><input class="form-control" required><select class="form-select" required></select>
  <div class="invalid-feedback">bad</div><div class="valid-feedback">ok</div>
  <input type="checkbox" class="btn-check" id="c1"><label class="btn btn-outline-primary" for="c1">Toggle</label>
  <div class="form-check"><input class="form-check-input" type="checkbox"><label class="form-check-label">C</label></div>
  <button class="btn btn-primary" type="submit">Go</button></form>
<div class="progress"><div class="progress-bar progress-bar-striped progress-bar-animated"></div></div>
<div class="spinner-border"></div><span class="badge text-bg-secondary">1</span>`

const bootstrapStates: Array<(root: HTMLElement) => void> = [
  root => {
    for (const el of root.querySelectorAll(
      '.dropdown-menu, .dropdown-toggle, .collapse, .modal, .fade, .toast, .offcanvas, .modal-backdrop',
    ))
      el.classList.add('show')
    for (const el of root.querySelectorAll(
      '.nav-link, .tab-pane, .carousel-item, .list-group-item',
    ))
      el.classList.add('active')
    for (const el of root.querySelectorAll('.collapsed')) el.classList.remove('collapsed')
    for (const el of root.querySelectorAll('[aria-expanded]'))
      el.setAttribute('aria-expanded', 'true')
    root.querySelector('form')?.classList.add('was-validated')
    for (const el of root.querySelectorAll('input, select')) el.classList.add('is-invalid')
  },
  root => {
    for (const el of root.querySelectorAll('.collapse'))
      el.classList.replace('collapse', 'collapsing')
    for (const el of root.querySelectorAll('input, select')) el.classList.add('is-valid')
  },
]

/** Class lists found in the shadcn sources (string literals that look like Tailwind classes). */
function shadcnClassLists(): string[] {
  const lists = new Set<string>()
  for (const source of shadcnSources) {
    for (const match of source.matchAll(/"([^"\n]*[ :][^"\n]*)"/g)) {
      const value = match[1]?.trim()
      if (value && /^[\w[\]&:/.=()*'%!@#>+~,-][^<>]*$/.test(value)) lists.add(value)
    }
  }
  return [...lists]
}

function setAll(root: HTMLElement, attributes: Record<string, string>): void {
  for (const el of root.querySelectorAll('[data-fixture]')) {
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
  }
}

describe('golden corpus: real CSS never reports live selectors as unused', () => {
  it('Bootstrap 5.3.8 components (dropdown, collapse, modal, tabs, accordion, forms, …)', () => {
    const sheet = addSheet(bootstrapCss)
    const root = mount('')
    const { live, wrong } = falseUnused(sheet, root, BOOTSTRAP_IDLE, bootstrapStates)
    expect(live).toBeGreaterThan(150)
    expect(wrong).toEqual([])
  })

  it('Tailwind 4.3.5 build of shadcn/ui components in open/active/checked states', () => {
    const sheet = addSheet(tailwindCss)
    const lists = shadcnClassLists()
    const idle = lists
      .map(
        list =>
          `<div data-fixture data-state="closed" class="${list.replaceAll('"', '&quot;')}"></div>`,
      )
      .join('')
    const root = mount('')
    const { live, wrong } = falseUnused(sheet, root, idle, [
      r =>
        setAll(r, {
          'data-state': 'open',
          'data-open': '',
          'data-highlighted': '',
          'data-disabled': '',
          'data-placeholder': '',
          'aria-expanded': 'true',
          'aria-invalid': 'true',
        }),
      r => setAll(r, { 'data-state': 'active' }),
      r => setAll(r, { 'data-state': 'checked', 'aria-checked': 'true', 'aria-selected': 'true' }),
    ])
    expect(live).toBeGreaterThan(100)
    expect(wrong).toEqual([])
  })
})

describe('validity over real selectors (property: no exceptions, no unknown)', () => {
  it('normalizes ≥ 5000 real selectors into browser-valid selectors', () => {
    const selectors = [bootstrapCss, tailwindCss, fontAwesomeCss].flatMap(css =>
      walkSheet(addSheet(css), 'fixture').map(entry => entry.selector),
    )
    const invalid: string[] = []
    for (const selector of selectors) {
      for (const transformed of [toRawMatchable(selector), normalizeState(selector)]) {
        try {
          document.querySelector(transformed)
        } catch {
          invalid.push(`${selector} → ${transformed}`)
        }
      }
    }
    expect(selectors.length).toBeGreaterThanOrEqual(5000)
    expect(invalid).toEqual([])
  })
})
