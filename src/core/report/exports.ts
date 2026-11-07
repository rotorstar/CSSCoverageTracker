import { selectorNames } from './selector-classes'
import type { Report, ReportSelector } from './types'

export interface SourceDeletionPlan {
  source: string
  /** Rules whose every selector is unused: delete the whole rule. */
  wholeRules: ReportSelector[][]
  /** Unused selectors inside a list that is still partly used: remove just the selector. */
  fromList: ReportSelector[]
  /** State-dependent: only delete if the state can never happen. */
  verify: ReportSelector[]
}

const isLiveUnused = (s: ReportSelector): boolean => s.status === 'unused' && !s.stale

/** Deletion list per stylesheet (plan C4). */
export function deletionPlan(report: Report): SourceDeletionPlan[] {
  const plans = new Map<string, SourceDeletionPlan>()
  const plan = (source: string): SourceDeletionPlan => {
    let p = plans.get(source)
    if (!p) {
      p = { source, wholeRules: [], fromList: [], verify: [] }
      plans.set(source, p)
    }
    return p
  }
  const groups = new Map<string, ReportSelector[]>()
  for (const selector of report.selectors) {
    if (selector.stale) continue
    const members = groups.get(selector.group) ?? []
    members.push(selector)
    groups.set(selector.group, members)
  }
  for (const members of groups.values()) {
    const unused = members.filter(isLiveUnused)
    for (const source of new Set(members.flatMap(m => m.sources))) {
      const p = plan(source)
      if (unused.length > 0 && unused.length === members.length) p.wholeRules.push(unused)
      else p.fromList.push(...unused)
      p.verify.push(...members.filter(m => m.status === 'state-dependent'))
    }
  }
  const unusedBytes = new Map(report.sources.map(s => [s.key, s.unusedBytes]))
  return [...plans.values()].sort(
    (a, b) => (unusedBytes.get(b.source) ?? 0) - (unusedBytes.get(a.source) ?? 0),
  )
}

export interface Remediation {
  /** Class names whose every selector is unused with high confidence. */
  classes: string[]
  lightningcss: { unusedSymbols: string[] }
  /** Tailwind v4 directives that stop generating the classes. */
  tailwind: string
  purgecss: { blocklist: string[] }
}

/**
 * Build-tool exports behind the confidence gate (plan D11): a class is listed
 * only if EVERY selector that mentions it (anywhere, incl. `:not()`) is a
 * high-confidence unused selector and no live/stale selector, #id, used @keyframes or
 * @counter-style shares the name — removing it can never touch live CSS.
 */
export function remediation(report: Report): Remediation {
  const safe = new Set<string>()
  // Build tools treat these names as global symbols (classes, ids, @keyframes, @counter-style):
  // a name is unsafe as soon as anything live, stale or uncertain uses it.
  const unsafe = new Set<string>([
    ...report.atRules.keyframes.filter(k => k.used).map(k => k.name),
    ...report.atRules.counterStyles,
  ])
  for (const selector of report.selectors) {
    const { classes, ids } = selectorNames(selector.selector)
    const isSafe = isLiveUnused(selector) && selector.confidence === 'high'
    for (const name of classes) (isSafe ? safe : unsafe).add(name)
    if (!isSafe) for (const name of ids) unsafe.add(name)
  }
  const classes = [...safe].filter(name => !unsafe.has(name)).sort()
  return {
    classes,
    lightningcss: { unusedSymbols: classes },
    tailwind: classes.map(name => `@source not inline(${JSON.stringify(name)});\n`).join(''),
    purgecss: { blocklist: classes },
  }
}

function csvField(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(report: Report): string {
  const header = 'selector,context,status,bytes,sources,routes,stale,confidence,referencedInJs'
  const rows = report.selectors.map(s =>
    [
      s.selector,
      s.context,
      s.status,
      Math.round(s.bytes),
      s.sources.join(' '),
      s.routes.join(' '),
      s.stale,
      s.confidence,
      s.referencedInJs,
    ]
      .map(csvField)
      .join(','),
  )
  return [header, ...rows].join('\n')
}

const kb = (bytes: number): string => (bytes / 1024).toFixed(1)

export function toMarkdown(report: Report, limit: number = 10): string {
  const { summary, coverage } = report
  const lines = [
    '# CSS coverage report',
    '',
    `Generated ${report.generatedAt} · ${report.tool.name} ${report.tool.version}`,
    '',
    `- Unused: **${kb(summary.bytes.unused)} KB** raw / **${kb(summary.bytes.unusedGzip)} KB** gzip (${summary.unusedPercent} % of ${kb(summary.bytes.total)} KB)`,
    `- Selectors: ${summary.selectors.used} used · ${summary.selectors['state-dependent']} state-dependent · ${summary.selectors.unused} unused · ${summary.selectors.unknown} unknown · ${summary.selectors.stale} stale`,
    `- Routes: ${coverage.visited} visited${coverage.known === null ? '' : ` of ${coverage.known} known (${Math.round((coverage.ratio ?? 0) * 100)} %)`}${coverage.allComplete ? '' : ' · some routes only partially scanned'}`,
    `- Contexts: ${report.contexts.join(', ') || '—'}`,
    '',
    `## Top files by unused KB`,
    '',
    '| File | Unused KB | Unused KB gzip | Render-blocking |',
    '| --- | ---: | ---: | --- |',
    ...[...report.sources]
      .sort((a, b) => b.unusedBytes - a.unusedBytes)
      .slice(0, limit)
      .map(
        s =>
          `| ${s.key} | ${kb(s.unusedBytes)} | ${kb(s.unusedGzipBytes)} | ${s.renderBlocking === null ? '?' : s.renderBlocking ? 'yes' : 'no'} |`,
      ),
    '',
    '## Deletion list',
  ]
  for (const plan of deletionPlan(report).slice(0, limit)) {
    lines.push('', `### ${plan.source}`, '')
    lines.push(`- Whole rules unused: ${plan.wholeRules.length}`)
    for (const rule of plan.wholeRules.slice(0, 20)) {
      const conf = rule.map(s => s.confidence ?? '').join('/')
      lines.push(`  - \`${rule.map(s => s.selector).join(', ')}\` (${conf})`)
    }
    lines.push(`- Remove from selector list: ${plan.fromList.length}`)
    for (const s of plan.fromList.slice(0, 20)) lines.push(`  - \`${s.selector}\``)
    lines.push(
      `- State-dependent (verify the state is unreachable before deleting): ${plan.verify.length}`,
    )
  }
  if (report.warnings.length > 0)
    lines.push('', '## Warnings', '', ...report.warnings.map(w => `- ${w}`))
  return `${lines.join('\n')}\n`
}
