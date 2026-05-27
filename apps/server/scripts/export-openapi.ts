/**
 * Output: Generate a local OpenAPI JSON snapshot for offline client generation.
 * Input: Cradle server app module metadata.
 * Position: Server tooling script under apps/server/scripts.
 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServerApp } from '../src/app'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const outputPath = resolve(scriptsDir, '..', 'openapi.json')

const app = await createServerApp({ startBackgroundTasks: false })
const response = await app.handle(new Request('http://localhost/openapi.json'))

if (!response.ok) {
  throw new Error(`Failed to generate OpenAPI JSON (status ${response.status})`)
}

const document = await response.json()
await writeFile(outputPath, JSON.stringify(document, null, 2))
