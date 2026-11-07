import { type CoverageTracker, UI_ATTRIBUTE } from '../core/api'
import type { CoverageState } from '../core/engine/state'
import { deletionPlan, remediation, toCsv, toMarkdown } from '../core/report/exports'
import type { Report } from '../core/report/types'
import { PANEL_CSS } from './panel-styles'

export type BadgePosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

export interface PanelOptions {
  readonly position?: BadgePosition
  /** Badge turns amber/red above these unused percentages. @default { warn: 15, bad: 30 } */
  readonly thresholds?: { readonly warn: number; readonly bad: number }
}

type Child = Node | string | null | false
type Props = Record<string, string | boolean | ((event: Event) => void)>

/** Tiny DOM builder: createElement/textContent only — no innerHTML (CSP, Trusted Types). */
function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === 'function') element.addEventListener(name.slice(2), value)
    else if (value === true) element.setAttribute(name, '')
    else if (value !== false) element.setAttribute(name, value)
  }
  for (const child of children) {
    if (child === null || child === false) continue
    element.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return element
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

/** Cheap badge numbers straight from the state (no async report). */
export function badgeSummary(state: CoverageState): {
  percent: number
  unusedBytes: number
  routes: number
} {
  let total = 0
  let unused = 0
  let unusedCount = 0
  let countable = 0
  for (const record of state.selectors.values()) {
    if (record.stale || record.status === 'print') continue
    countable++
    total += record.bytes
    if (record.status === 'unused') {
      unused += record.bytes
      unusedCount++
    }
  }
  const percent =
    total > 0
      ? Math.round((unused / total) * 100)
      : countable > 0
        ? Math.round((unusedCount / countable) * 100)
        : 0
  return {
    percent,
    unusedBytes: unused,
    routes: [...state.routes.values()].filter(r => r.visits > 0).length,
  }
}

function download(root: ShadowRoot, name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = h('a', { href: url, download: name })
  root.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const TAG = 'css-coverage-panel'

/** Mount badge + report dialog for a tracker. Returns an unmount function. */
export function mountPanel(tracker: CoverageTracker, options: PanelOptions = {}): () => void {
  const host = document.createElement(TAG)
  host.setAttribute(UI_ATTRIBUTE, '')
  const shadow = host.attachShadow({ mode: 'open' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(PANEL_CSS)
  shadow.adoptedStyleSheets = [sheet]

  const thresholds = options.thresholds ?? { warn: 15, bad: 30 }
  const badge = h('button', {
    type: 'button',
    class: `badge ${options.position ?? 'bottom-left'}`,
    popover: 'manual',
    'aria-haspopup': 'dialog',
  })
  const title = h('h2', { id: 'ccov-title' }, 'CSS coverage')
  const body = h('div', { class: 'body' }, h('p', { class: 'muted' }, 'Collecting…'))
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-labelledby', 'ccov-title')
  dialog.append(title, body)
  shadow.append(badge, dialog)
  // under <html>, not <body>: never shifts :last-child / body > * of the app (plan A7)
  document.documentElement.append(host)
  if (typeof badge.showPopover === 'function') badge.showPopover()

  let view: 'files' | 'selectors' | 'routes' = 'files'
  let filter = ''
  let statusFilter = 'unused'
  let report: Report | null = null

  // Keep the same text node: replacing it between pointerdown and click makes WebKit drop the click.
  const label = document.createTextNode('')
  badge.append(label)
  const updateBadge = (): void => {
    const { percent, unusedBytes, routes } = badgeSummary(tracker.getState())
    const text = `CSS ${percent}% unused · ${kb(unusedBytes)} · ${routes} route${routes === 1 ? '' : 's'}`
    if (label.data !== text) label.data = text
    badge.classList.toggle('warn', percent > thresholds.warn && percent <= thresholds.bad)
    badge.classList.toggle('bad', percent > thresholds.bad)
    badge.setAttribute('aria-label', `CSS coverage: ${text}. Open report`)
  }

  const results = (): HTMLElement => {
    const list = h('ul', { class: 'results', 'aria-label': `${view} results` })
    if (!report) return list
    const needle = filter.toLowerCase()
    const rows: HTMLElement[] = []
    if (view === 'files') {
      for (const source of [...report.sources].sort((a, b) => b.unusedBytes - a.unusedBytes)) {
        if (needle && !source.key.toLowerCase().includes(needle)) continue
        rows.push(
          h(
            'li',
            {},
            h(
              'span',
              { class: 'mono' },
              source.key,
              source.readable ? '' : ' (not readable: CORS)',
            ),
            h('span', {}, `${kb(source.unusedBytes)} unused`),
            h('span', { class: 'muted' }, `${kb(source.unusedGzipBytes)} gz`),
          ),
        )
      }
    } else if (view === 'routes') {
      for (const route of report.routes) {
        if (needle && !route.route.toLowerCase().includes(needle)) continue
        const specific = report.selectors.filter(
          s => s.routes.length === 1 && s.routes[0] === route.route,
        ).length
        rows.push(
          h(
            'li',
            {},
            h('span', { class: 'mono' }, route.route),
            h('span', {}, route.status),
            h('span', { class: 'muted' }, `${specific} route-specific selectors`),
          ),
        )
      }
    } else {
      for (const selector of report.selectors) {
        if (statusFilter !== 'all' && selector.status !== statusFilter) continue
        if (needle && !selector.selector.toLowerCase().includes(needle)) continue
        rows.push(
          h(
            'li',
            {},
            h('span', { class: 'mono' }, selector.selector),
            h(
              'span',
              { class: `status-${selector.status}` },
              selector.stale ? 'stale' : selector.status,
            ),
            h('span', { class: 'muted' }, selector.confidence ?? `${Math.round(selector.bytes)} B`),
          ),
        )
      }
    }
    const limit = 200
    list.append(...rows.slice(0, limit))
    if (rows.length > limit)
      list.append(
        h('li', { class: 'muted' }, `… ${rows.length - limit} more (use the filter or export)`),
      )
    if (rows.length === 0) list.append(h('li', { class: 'muted' }, 'Nothing to show.'))
    return list
  }

  const render = (): void => {
    if (!report) return
    const { summary, coverage } = report
    const fix = remediation(report)
    const plans = deletionPlan(report)
    const resultsSlot = h('div', {}, results())
    const rerender = (): void => resultsSlot.replaceChildren(results())
    const action = (label: string, onClick: () => void, extra: Props = {}): HTMLElement =>
      h('button', { type: 'button', class: 'action', onclick: onClick, ...extra }, label)
    const name = (ext: string): string =>
      `css-coverage-${new Date().toISOString().slice(0, 10)}.${ext}`
    const current = report

    body.replaceChildren(
      h(
        'p',
        {},
        `Unused: ${kb(summary.bytes.unused)} raw / ${kb(summary.bytes.unusedGzip)} gzip (${summary.unusedPercent}% of ${kb(summary.bytes.total)}). `,
        `Selectors: ${summary.selectors.used} used, ${summary.selectors['state-dependent']} state-dependent, ${summary.selectors.unused} unused, ${summary.selectors.unknown} unknown, ${summary.selectors.stale} stale.`,
      ),
      h(
        'p',
        { class: 'muted' },
        `Routes: ${coverage.visited} visited${coverage.known === null ? ' (no route inventory: set knownRoutes or sitemap for high-confidence deletions)' : ` of ${coverage.known} known (${Math.round((coverage.ratio ?? 0) * 100)}%)`}. `,
        `Contexts: ${report.contexts.join(', ') || '—'}. Deletable rules: ${plans.reduce((n, p) => n + p.wholeRules.length, 0)}.`,
      ),
      report.warnings.length > 0
        ? h('ul', { class: 'warn-list' }, ...report.warnings.map(w => h('li', {}, w)))
        : h('span', { hidden: true }),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'select',
          {
            'aria-label': 'View',
            onchange: event => {
              const target = event.target
              if (
                target instanceof HTMLSelectElement &&
                (target.value === 'files' ||
                  target.value === 'routes' ||
                  target.value === 'selectors')
              ) {
                view = target.value
                rerender()
              }
            },
          },
          h('option', { value: 'files', selected: view === 'files' }, 'Files'),
          h('option', { value: 'routes', selected: view === 'routes' }, 'Routes'),
          h('option', { value: 'selectors', selected: view === 'selectors' }, 'Selectors'),
        ),
        h(
          'select',
          {
            'aria-label': 'Status filter (selectors view)',
            onchange: event => {
              if (event.target instanceof HTMLSelectElement) statusFilter = event.target.value
              rerender()
            },
          },
          ...['unused', 'state-dependent', 'used', 'unknown', 'print', 'all'].map(value =>
            h('option', { value, selected: statusFilter === value }, value),
          ),
        ),
        h('input', {
          type: 'search',
          placeholder: 'Filter…',
          'aria-label': 'Filter results',
          value: filter,
          oninput: event => {
            if (event.target instanceof HTMLInputElement) filter = event.target.value
            rerender()
          },
        }),
      ),
      resultsSlot,
      h(
        'div',
        { class: 'actions' },
        action('Rescan', () => void tracker.scan().then(refresh), { class: 'action primary' }),
        action('New audit', () => void tracker.newEpoch().then(refresh)),
        action('JSON', () =>
          download(shadow, name('json'), 'application/json', JSON.stringify(current, null, 2)),
        ),
        action('CSV', () => download(shadow, name('csv'), 'text/csv', toCsv(current))),
        action('Markdown', () =>
          download(shadow, name('md'), 'text/markdown', toMarkdown(current)),
        ),
        action(
          'Lightning CSS',
          () =>
            download(
              shadow,
              'unused-symbols.json',
              'application/json',
              JSON.stringify(fix.lightningcss, null, 2),
            ),
          gate(fix.classes.length),
        ),
        action(
          'Tailwind',
          () => download(shadow, 'unused-classes.css', 'text/css', fix.tailwind),
          gate(fix.classes.length),
        ),
        action(
          'PurgeCSS',
          () =>
            download(
              shadow,
              'purgecss-blocklist.json',
              'application/json',
              JSON.stringify(fix.purgecss, null, 2),
            ),
          gate(fix.classes.length),
        ),
        action('Close', () => dialog.close()),
      ),
    )
  }

  function gate(count: number): Props {
    return count > 0
      ? { title: `${count} classes are unused with high confidence` }
      : {
          disabled: true,
          title:
            'Needs high-confidence unused classes (route coverage ≥ threshold, all routes scanned, no JS references)',
        }
  }

  const refresh = async (): Promise<void> => {
    report = await tracker.getReport()
    render()
    updateBadge()
  }

  const open = (): void => {
    if (dialog.open) return
    // never show the previous report's controls: input there would land in
    // fields that the fresh render replaces a moment later
    body.replaceChildren(h('p', { class: 'muted' }, 'Collecting…'))
    dialog.showModal()
    void refresh()
  }
  badge.addEventListener('click', open)
  const onKey = (event: KeyboardEvent): void => {
    if (event.altKey && event.shiftKey && event.code === 'KeyC') {
      event.preventDefault()
      if (dialog.open) dialog.close()
      else open()
    }
  }
  document.addEventListener('keydown', onKey)
  const unsubscribe = tracker.subscribe(updateBadge)
  updateBadge()

  return () => {
    unsubscribe()
    document.removeEventListener('keydown', onKey)
    host.remove()
  }
}
