// Writes the JSON Schema of report v2 (generated from the Zod schema) to dist/report.schema.json.
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { reportSchema } from '../dist/schema.mjs'

const schema = {
  $id: 'https://unpkg.com/css-coverage-tracker/dist/report.schema.json',
  title: 'CSS Coverage Tracker report v2',
  ...z.toJSONSchema(reportSchema),
}
await writeFile('dist/report.schema.json', `${JSON.stringify(schema, null, 2)}\n`)
console.log('dist/report.schema.json written')
