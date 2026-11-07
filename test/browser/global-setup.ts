/** Serves a stylesheet from a second origin (CORS enabled) for the cross-origin tests. */
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    crossOrigin: string
  }
}

let server: Server | undefined

export async function setup(project: TestProject): Promise<void> {
  const css = await readFile(new URL('../fixtures/css/linked.css', import.meta.url), 'utf8')
  server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Content-Type', 'text/css')
    response.end(request.url?.startsWith('/linked.css') ? css : '')
  })
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  project.provide('crossOrigin', `http://127.0.0.1:${port}`)
}

export async function teardown(): Promise<void> {
  await new Promise(resolve => server?.close(resolve))
}
