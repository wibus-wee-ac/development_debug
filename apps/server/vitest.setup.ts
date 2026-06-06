import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll } from 'vitest'

import { shutdownInfra } from './src/infra'

const testDataDir = mkdtempSync(join(tmpdir(), 'cradle-server-vitest-'))

process.env.CRADLE_DATA_DIR = testDataDir
delete process.env.CRADLE_DB_PATH

afterAll(() => {
  shutdownInfra()
  rmSync(testDataDir, { recursive: true, force: true })
})
