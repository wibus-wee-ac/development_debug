// Input: AppExceptionFilter + AppError
// Output: AppError response normalization test
// Position: apps/server/tests

/// <reference types="node" />

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Constructor } from '@tsuki-hono/common'
import { APP_FILTER, Controller, Get, Module } from '@tsuki-hono/common'
import { createApplication } from '@tsuki-hono/core'
import { injectable } from 'tsyringe'
import { describe, expect, it } from 'vitest'

import { ServerConfig } from '../src/config/server-config'
import { AppError } from '../src/errors/app-error'
import { AppExceptionFilter } from '../src/filters/app-exception.filter'
import { Logger } from '../src/logging/logger'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

@injectable()
@Controller('boom')
class BoomController {
  // @ts-expect-error -- decorators in tests require experimentalDecorators tsconfig
  @Get('/')
  crash() {
    throw new AppError({ code: 'boom', status: 418, message: 'boom' })
  }
}

@Module({
  controllers: [BoomController],
  providers: [
    ServerConfig,
    Logger,
    { provide: APP_FILTER as unknown as Constructor, useClass: AppExceptionFilter },
    AppExceptionFilter,
  ],
})
class BoomModule {}

describe('app exception filter', () => {
  it('normalizes AppError responses', async () => {
    const dataDir = makeTempDataDir()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createApplication>> | undefined

    try {
      app = await createApplication(BoomModule)
      const res = await app.getInstance().request('/boom')
      expect(res.status).toBe(418)
      const body = await res.json()
      expect(body.code).toBe('boom')
      expect(body.message).toBe('boom')
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
