#!/usr/bin/env node
/**
 * css-coverage — merge, report, diff and budget-check CSS coverage reports (report v2).
 *
 *   css-coverage merge <file|dir…> [-o merged.json] [--routes routes.txt]
 *   css-coverage report <file|dir…> [--format md|html|csv|json] [-o out]
 *   css-coverage diff <before.json> <after.json> [--format md|json]
 *   css-coverage check <file|dir…> [--max-unused-kb N] [--max-unused-pct N]
 *                      [--baseline file --no-new-unused] [--min-route-coverage 0.9] [--routes file]
 */
import { appendFile, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { remediation, toCsv, toMarkdown } from '../core/report/exports'
import type { Report } from '../core/report/types'
import { parseReport } from '../schema/report'
import {
  type CdpCssCoverage,
  checkReport,
  diffReports,
  diffToMarkdown,
  mergeReports,
  toHtml,
} from './commands'

const VERSION = __CSS_COVERAGE_VERSION__
const USAGE = `css-coverage ${VERSION}
Usage:
  css-coverage merge <file|dir…> [-o merged.json] [--routes routes.txt] [--cdp playwright-css-coverage.json]
  css-coverage report <file|dir…> [--format md|html|csv|json|lightningcss|tailwind|purgecss] [-o out]
  css-coverage diff <before.json> <after.json> [--format md|json]
  css-coverage check <file|dir…> [--max-unused-kb N] [--max-unused-pct N]
                     [--baseline file] [--no-new-unused] [--min-route-coverage R] [--routes file]`

async function jsonFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = []
  for (const path of paths) {
    if ((await stat(path)).isDirectory()) {
      for (const name of (await readdir(path)).sort())
        if (name.endsWith('.json')) files.push(join(path, name))
    } else files.push(path)
  }
  return files
}

async function loadReport(file: string): Promise<Report> {
  try {
    return parseReport(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    throw new Error(
      `${file} is not a valid css-coverage report v2: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function loadMerged(
  paths: readonly string[],
  routesFile?: string,
  cdpFile?: string,
): Promise<Report> {
  const files = await jsonFiles(paths)
  if (files.length === 0) throw new Error('No report files given')
  const reports = await Promise.all(files.map(loadReport))
  const knownRoutes = routesFile
    ? (await readFile(routesFile, 'utf8'))
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    : []
  const cdp = cdpFile ? parseCdp(JSON.parse(await readFile(cdpFile, 'utf8'))) : undefined
  return reports.length === 1 && knownRoutes.length === 0 && !cdp
    ? (reports[0] as Report)
    : mergeReports(reports, { version: VERSION, knownRoutes, ...(cdp ? { cdp } : {}) })
}

function parseCdp(value: unknown): CdpCssCoverage[] {
  if (!Array.isArray(value))
    throw new Error('--cdp expects the JSON array returned by page.coverage.stopCSSCoverage()')
  return value.filter(
    (entry): entry is CdpCssCoverage =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.url === 'string' &&
      Array.isArray(entry.ranges),
  )
}

async function output(text: string, file: string | undefined): Promise<void> {
  if (file) await writeFile(file, text)
  else process.stdout.write(text)
}

export async function main(argv: readonly string[]): Promise<number> {
  const [first, ...others] = argv
  const command = first?.startsWith('-') ? 'help' : first
  const rest = first?.startsWith('-') ? others : others
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      format: { type: 'string' },
      routes: { type: 'string' },
      cdp: { type: 'string' },
      baseline: { type: 'string' },
      'max-unused-kb': { type: 'string' },
      'max-unused-pct': { type: 'string' },
      'min-route-coverage': { type: 'string' },
      'no-new-unused': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (!command || values.help || command === 'help') {
    console.log(USAGE)
    return command ? 0 : 2
  }
  const number = (value: string | undefined): number | undefined =>
    value === undefined ? undefined : Number(value)

  switch (command) {
    case 'merge': {
      const merged = await loadMerged(positionals, values.routes, values.cdp)
      await output(`${JSON.stringify(merged, null, 2)}\n`, values.output)
      return 0
    }
    case 'report': {
      const report = await loadMerged(positionals, values.routes, values.cdp)
      const format = values.format ?? 'md'
      const fix = remediation(report)
      const text =
        format === 'lightningcss'
          ? `${JSON.stringify(fix.lightningcss, null, 2)}\n`
          : format === 'purgecss'
            ? `${JSON.stringify(fix.purgecss, null, 2)}\n`
            : format === 'tailwind'
              ? fix.tailwind
              : format === 'html'
                ? toHtml(report)
                : format === 'csv'
                  ? `${toCsv(report)}\n`
                  : format === 'json'
                    ? `${JSON.stringify(report, null, 2)}\n`
                    : toMarkdown(report)
      await output(text, values.output)
      return 0
    }
    case 'diff': {
      const [before, after] = positionals
      if (!before || !after) throw new Error('diff needs <before.json> <after.json>')
      const diff = diffReports(await loadReport(before), await loadReport(after))
      await output(
        values.format === 'json' ? `${JSON.stringify(diff, null, 2)}\n` : diffToMarkdown(diff),
        values.output,
      )
      return 0
    }
    case 'check': {
      const report = await loadMerged(positionals, values.routes)
      const maxUnusedKb = number(values['max-unused-kb'])
      const maxUnusedPct = number(values['max-unused-pct'])
      const minRouteCoverage = number(values['min-route-coverage'])
      const result = checkReport(report, {
        ...(maxUnusedKb === undefined ? {} : { maxUnusedKb }),
        ...(maxUnusedPct === undefined ? {} : { maxUnusedPct }),
        ...(minRouteCoverage === undefined ? {} : { minRouteCoverage }),
        ...(values.baseline ? { baseline: await loadReport(values.baseline) } : {}),
        noNewUnused: values['no-new-unused'] === true,
      })
      console.log(result.summary)
      const summaryFile = process.env.GITHUB_STEP_SUMMARY
      if (summaryFile) await appendFile(summaryFile, `${result.summary}\n`)
      return result.ok ? 0 : 1
    }
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`)
      return 2
  }
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 2
  },
)
