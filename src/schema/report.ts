import { z } from 'zod'

import type { Report } from '../core/report/types'

/**
 * Runtime validation of report v2 files (CLI). The schema and the TypeScript
 * types in `core/report/types.ts` are tied together by the compile-time
 * equality check below — change one without the other and the build fails.
 */
const SelectorStatusSchema = z.enum(['used', 'unused', 'state-dependent', 'print', 'unknown'])
const ConfidenceSchema = z.enum(['high', 'medium', 'low'])
const RouteStatusSchema = z.enum(['pending', 'partial', 'complete'])

const ReportSelectorSchema = z.object({
  selector: z.string(),
  /** Enclosing at-rules (`@media … > @layer …`); empty at top level. */
  context: z.string(),
  status: SelectorStatusSchema,
  /** Serialized bytes of the rule share (UTF-8). */
  bytes: z.number().nonnegative(),
  sources: z.array(z.string()),
  routes: z.array(z.string()),
  stale: z.boolean(),
  /** Selectors of the same rule (selector list) share a group id. */
  group: z.string(),
  /** Unused only: class names of the selector appear in same-origin JavaScript. */
  referencedInJs: z.boolean().nullable(),
  /** Unused only: how safe deleting it is. */
  confidence: ConfidenceSchema.nullable(),
})

const ReportSourceSchema = z.object({
  key: z.string(),
  href: z.string().nullable(),
  kind: z.enum(['link', 'style', 'import', 'adopted', 'shadow', 'fetched']),
  media: z.string(),
  readable: z.boolean(),
  renderBlocking: z.boolean().nullable(),
  framework: z.enum(['tailwind']).nullable(),
  serializedBytes: z.number().nonnegative(),
  /** File size from Resource Timing (uncompressed / transfer). */
  decodedBytes: z.number().nonnegative().nullable(),
  encodedBytes: z.number().nonnegative().nullable(),
  unusedBytes: z.number().nonnegative(),
  unusedGzipBytes: z.number().nonnegative(),
  cdpUnusedBytes: z.number().nonnegative().nullable(),
})

const ReportRouteSchema = z.object({
  route: z.string(),
  status: RouteStatusSchema,
  visits: z.number().int().nonnegative(),
})

const StatusCountsSchema = z.object({
  used: z.number().int(),
  unused: z.number().int(),
  'state-dependent': z.number().int(),
  print: z.number().int(),
  unknown: z.number().int(),
  stale: z.number().int(),
})

const ReportSchema = z.object({
  schema: z.literal('css-coverage/v2'),
  generatedAt: z.string(),
  tool: z.object({ name: z.string(), version: z.string() }),
  epoch: z.number().int(),
  contexts: z.array(z.string()),
  routes: z.array(ReportRouteSchema),
  knownRoutes: z.array(z.string()),
  coverage: z.object({
    visited: z.number().int(),
    known: z.number().int().nullable(),
    /** visited ∩ known / known; null without a route inventory. */
    ratio: z.number().nullable(),
    allComplete: z.boolean(),
  }),
  sources: z.array(ReportSourceSchema),
  selectors: z.array(ReportSelectorSchema),
  atRules: z.object({
    keyframes: z.array(z.object({ name: z.string(), source: z.string(), used: z.boolean() })),
    fontFaces: z.array(z.object({ family: z.string(), loaded: z.boolean() })),
    counterStyles: z.array(z.string()),
  }),
  summary: z.object({
    selectors: StatusCountsSchema,
    bytes: z.object({
      total: z.number(),
      unused: z.number(),
      unusedGzip: z.number(),
    }),
    unusedPercent: z.number(),
  }),
  warnings: z.array(z.string()),
})

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const schemaMatchesTypes: Equal<z.infer<typeof ReportSchema>, Report> = true

/** Validated report schema (types from `core/report/types.ts`). */
export const reportSchema: z.ZodType<Report> = ReportSchema
void schemaMatchesTypes

/** Parse and validate a report v2 document; throws a readable error when invalid. */
export function parseReport(value: unknown): Report {
  return reportSchema.parse(value)
}
