// Copies the README's Next.js code blocks (first line `// app/<file>`) verbatim into
// fixtures/next16, so `next build` type-checks exactly what the README shows (plan AC-D).
import { readFile, writeFile } from 'node:fs/promises'

const readme = await readFile('README.md', 'utf8')
const blocks = [...readme.matchAll(/```tsx\n\/\/ (app\/[\w./-]+)[^\n]*\n([\s\S]*?)```/g)]
if (blocks.length < 2) throw new Error('README Next.js snippets not found')
for (const [, file, body] of blocks) {
  await writeFile(`fixtures/next16/${file}`, body)
  console.log(`synced fixtures/next16/${file}`)
}
