# Cradle Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Tsuki/Hono server foundation (config, logging, request tracing, error handling, health, DB lifecycle entry) with clear core/infra boundaries.

**Architecture:** `AppModule` imports `CoreModule` + `InfraModule`. Core owns config/logging/errors/request-tracing/health. Infra owns DB lifecycle. Global middleware and filters are registered via `APP_MIDDLEWARE` and `APP_FILTER` tokens.

**Tech Stack:** TypeScript, Tsuki/Hono, Zod, Drizzle (better-sqlite3), Vitest.

---

## File Map (Create/Modify)

**Create**
- `apps/server/src/core/README.md`
- `apps/server/src/core/core.module.ts`
- `apps/server/src/core/config/server-config.ts`
- `apps/server/src/core/logging/logger.ts`
- `apps/server/src/core/errors/app-error.ts`
- `apps/server/src/core/errors/app-exception.filter.ts`
- `apps/server/src/core/request/request-context.ts`
- `apps/server/src/core/request/request-id.middleware.ts`
- `apps/server/src/core/health/health.controller.ts`
- `apps/server/src/core/health/health.module.ts`
- `apps/server/src/infra/README.md`
- `apps/server/src/infra/infra.module.ts`
- `apps/server/src/infra/database/database.module.ts`
- `apps/server/src/infra/database/database.config.ts`
- `apps/server/src/infra/database/database.provider.ts`
- `apps/server/src/infra/database/migration-runner.ts`
- `apps/server/src/infra/database/db-accessor.ts`
- `apps/server/src/infra/database/README.md`
- `apps/server/src/capabilities/README.md`
- `apps/server/tests/README.md`
- `apps/server/tests/config.test.ts`
- `apps/server/tests/request-id.test.ts`
- `apps/server/tests/exception-filter.test.ts`
- `apps/server/tests/database.test.ts`

**Modify**
- `apps/server/src/app.module.ts`
- `apps/server/src/app.factory.ts`
- `apps/server/src/index.ts`
- `apps/server/tests/health.test.ts`
- `apps/server/package.json`

---

### Task 1: Restructure foundation directories + move health module

**Files:**
- Create: `apps/server/src/core/README.md`, `apps/server/src/infra/README.md`, `apps/server/src/capabilities/README.md`, `apps/server/tests/README.md`
- Move: `apps/server/src/modules/health/*` → `apps/server/src/core/health/*`
- Modify: `apps/server/src/app.module.ts`

- [ ] **Step 1: Create core/infra/capabilities README files**

```md
<!--
Output: Core foundation inventory for server runtime.
Input: Core modules (config/logging/errors/request/health).
Position: apps/server/src/core index.
-->

# Core

Server runtime foundation: config, logging, errors, request tracing, health.
```

```md
<!--
Output: Infra inventory for server adapters.
Input: DB lifecycle and system adapters.
Position: apps/server/src/infra index.
-->

# Infra

System adapters for the server runtime (database lifecycle, filesystem paths).
```

```md
<!--
Output: Capability inventory for server migration.
Input: Future capability modules.
Position: apps/server/src/capabilities index.
-->

# Capabilities

Placeholder for capability modules migrated from the legacy service layer.
```

```md
<!--
Output: apps/server test inventory.
Input: Vitest suites for server foundation.
Position: apps/server/tests index.
-->

# Server Tests

Vitest suites covering server foundation behavior.
```

- [ ] **Step 2: Move health module into core**

```bash
mkdir -p apps/server/src/core/health
mv apps/server/src/modules/health/health.controller.ts apps/server/src/core/health/health.controller.ts
mv apps/server/src/modules/health/health.module.ts apps/server/src/core/health/health.module.ts
rmdir apps/server/src/modules/health
```

- [ ] **Step 3: Update health module file headers**

```ts
// Input: Tsuki controller decorators
// Output: /health handler
// Position: core health controller

import { Controller, Get } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

@injectable()
@Controller('health')
export class HealthController {
  @Get('/')
  check() {
    return { status: 'ok', timestamp: Date.now() }
  }
}
```

```ts
// Input: HealthController
// Output: HealthModule registration
// Position: core health module

import { Module } from '@tsuki-hono/common'

import { HealthController } from './health.controller'

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 4: Update `app.module.ts` import path (temporary, before CoreModule exists)**

```ts
import { Module } from '@tsuki-hono/common'

import { HealthModule } from './core/health/health.module'

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core apps/server/src/capabilities apps/server/src/infra apps/server/tests apps/server/src/app.module.ts

git commit -m "refactor(server): introduce core/infra/capabilities layout"
```

---

### Task 2: Add typed server config (Zod) + tests

**Files:**
- Create: `apps/server/src/core/config/server-config.ts`
- Create: `apps/server/tests/config.test.ts`

- [ ] **Step 1: Add config tests (expected to fail)**

```ts
import { describe, expect, it } from 'vitest'

import { loadServerConfig } from '../src/core/config/server-config'

describe('server config', () => {
  it('parses defaults and derives dbPath from data dir', () => {
    const cfg = loadServerConfig({ CRADLE_DATA_DIR: '/tmp/cradle-data' })
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(21423)
    expect(cfg.dbPath).toBe('/tmp/cradle-data/cradle.db')
  })

  it('throws when no db path provided', () => {
    expect(() => loadServerConfig({})).toThrow(/CRADLE_DATA_DIR or CRADLE_DB_PATH/)
  })
})
```

- [ ] **Step 2: Run tests (should fail)**

Run: `pnpm -C apps/server test -- --run tests/config.test.ts`
Expected: FAIL (module not implemented)

- [ ] **Step 3: Add server config module**

```ts
// Input: process.env
// Output: validated server config
// Position: core config module

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'
import { injectable } from 'tsyringe'

const logLevels = ['debug', 'info', 'warn', 'error'] as const

const serverConfigSchema = z.object({
  CRADLE_HOST: z.string().default('127.0.0.1'),
  CRADLE_PORT: z.coerce.number().int().positive().default(21423),
  CRADLE_LOG_LEVEL: z.enum(logLevels).default('info'),
  CRADLE_DATA_DIR: z.string().optional(),
  CRADLE_DB_PATH: z.string().optional(),
})

export type LogLevel = (typeof logLevels)[number]

export interface ServerConfigValues {
  host: string
  port: number
  logLevel: LogLevel
  dataDir?: string
  dbPath: string
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfigValues {
  const parsed = serverConfigSchema.parse(env)
  const dbPath = parsed.CRADLE_DB_PATH ??
    (parsed.CRADLE_DATA_DIR ? join(parsed.CRADLE_DATA_DIR, 'cradle.db') : undefined)

  if (!dbPath) {
    throw new Error('CRADLE_DATA_DIR or CRADLE_DB_PATH is required')
  }

  if (parsed.CRADLE_DATA_DIR) {
    mkdirSync(parsed.CRADLE_DATA_DIR, { recursive: true })
  }

  return {
    host: parsed.CRADLE_HOST,
    port: parsed.CRADLE_PORT,
    logLevel: parsed.CRADLE_LOG_LEVEL,
    dataDir: parsed.CRADLE_DATA_DIR,
    dbPath,
  }
}

@injectable()
export class ServerConfig {
  private readonly config = loadServerConfig()

  get(): ServerConfigValues {
    return this.config
  }
}
```

- [ ] **Step 4: Run tests (should pass)**

Run: `pnpm -C apps/server test -- --run tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/config apps/server/tests/config.test.ts

git commit -m "feat(server): add typed server config"
```

---

### Task 3: Add logging, request context, and request-id middleware

**Files:**
- Create: `apps/server/src/core/logging/logger.ts`
- Create: `apps/server/src/core/request/request-context.ts`
- Create: `apps/server/src/core/request/request-id.middleware.ts`
- Create: `apps/server/tests/request-id.test.ts`

- [ ] **Step 1: Add logger service**

```ts
// Input: ServerConfig log level
// Output: structured logger interface
// Position: core logging module

import { injectable } from 'tsyringe'

import type { LogLevel, ServerConfigValues } from '../config/server-config'
import { ServerConfig } from '../config/server-config'

export interface LoggerFields {
  [key: string]: unknown
}

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

@injectable()
export class Logger {
  private readonly config: ServerConfigValues

  constructor(serverConfig: ServerConfig) {
    this.config = serverConfig.get()
  }

  private shouldLog(level: LogLevel): boolean {
    return levelRank[level] >= levelRank[this.config.logLevel]
  }

  debug(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('debug')) console.debug(message, fields ?? {})
  }

  info(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('info')) console.info(message, fields ?? {})
  }

  warn(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('warn')) console.warn(message, fields ?? {})
  }

  error(message: string, fields?: LoggerFields): void {
    if (this.shouldLog('error')) console.error(message, fields ?? {})
  }
}
```

- [ ] **Step 2: Add request context types**

```ts
// Input: HttpContext values
// Output: requestId type augmentation
// Position: core request context

export const REQUEST_ID_HEADER = 'x-request-id'

declare module '@tsuki-hono/common' {
  interface HttpContextValues {
    requestId?: string
  }
}
```

- [ ] **Step 3: Add request-id middleware**

```ts
// Input: Request headers + HttpContext
// Output: requestId injection
// Position: core request middleware

import { randomUUID } from 'node:crypto'

import { HttpContext, Middleware } from '@tsuki-hono/common'
import type { Context, Next } from 'hono'
import { injectable } from 'tsyringe'

import { REQUEST_ID_HEADER } from './request-context'

@Middleware({ path: '/*', priority: -20 })
@injectable()
export class RequestIdMiddleware {
  async use(context: Context, next: Next): Promise<void> {
    const incoming = context.req.header(REQUEST_ID_HEADER)
    const requestId = incoming?.trim() || randomUUID()

    HttpContext.assign({ requestId })
    context.header(REQUEST_ID_HEADER, requestId)

    await next()
  }
}
```

- [ ] **Step 4: Add request-id integration test (expected to fail until CoreModule wiring)**

```ts
import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('request id middleware', () => {
  it('adds x-request-id header', async () => {
    const dataDir = makeTempDataDir()
    process.env.CRADLE_DATA_DIR = dataDir

    const app = await createConfiguredApp()
    const hono = app.getInstance()

    const res = await hono.request('/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()

    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
    delete process.env.CRADLE_DATA_DIR
  })
})
```

- [ ] **Step 5: Run tests (request-id should fail until CoreModule wiring)**

Run: `pnpm -C apps/server test -- --run tests/request-id.test.ts`
Expected: FAIL (middleware not registered yet)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/core/logging apps/server/src/core/request apps/server/tests/request-id.test.ts

git commit -m "feat(server): add request tracing primitives"
```

---

### Task 4: Add AppError + global exception filter + tests

**Files:**
- Create: `apps/server/src/core/errors/app-error.ts`
- Create: `apps/server/src/core/errors/app-exception.filter.ts`
- Create: `apps/server/tests/exception-filter.test.ts`

- [ ] **Step 1: Add AppError**

```ts
// Input: error code + status
// Output: typed application error
// Position: core error utilities

export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(options: { code: string; status: number; message: string; details?: Record<string, unknown> }) {
    super(options.message)
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}
```

- [ ] **Step 2: Add global exception filter**

```ts
// Input: thrown errors + HttpContext
// Output: normalized error response
// Position: core exception filter

import { HttpContext, type ArgumentsHost, type ExceptionFilter } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

import { Logger } from '../logging/logger'
import { AppError } from './app-error'

@injectable()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.getContext().hono
    const requestId = HttpContext.get().requestId

    if (exception instanceof AppError) {
      return ctx.json(
        {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          requestId,
        },
        exception.status,
      )
    }

    const message = exception instanceof Error ? exception.message : 'Internal server error'
    this.logger.error('Unhandled error', { requestId, message })

    return ctx.json(
      {
        code: 'internal_error',
        message: 'Internal server error',
        requestId,
      },
      500,
    )
  }
}
```

- [ ] **Step 3: Add exception filter test (expected to fail until CoreModule wiring)**

```ts
import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Controller, Get, Module } from '@tsuki-hono/common'
import { createApplication } from '@tsuki-hono/core'
import { injectable } from 'tsyringe'

import { AppExceptionFilter } from '../src/core/errors/app-exception.filter'
import { AppError } from '../src/core/errors/app-error'
import { APP_FILTER, type Constructor } from '@tsuki-hono/common'
import { Logger } from '../src/core/logging/logger'
import { ServerConfig } from '../src/core/config/server-config'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

@injectable()
@Controller('boom')
class BoomController {
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
    process.env.CRADLE_DATA_DIR = dataDir

    const app = await createApplication(BoomModule)
    const res = await app.getInstance().request('/boom')
    expect(res.status).toBe(418)
    const body = await res.json()
    expect(body.code).toBe('boom')
    expect(body.message).toBe('boom')
    await app.close()

    rmSync(dataDir, { recursive: true, force: true })
    delete process.env.CRADLE_DATA_DIR
  })
})
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm -C apps/server test -- --run tests/exception-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/errors apps/server/tests/exception-filter.test.ts

git commit -m "feat(server): add global exception filter"
```

---

### Task 5: Add DB lifecycle module (infra)

**Files:**
- Create: `apps/server/src/infra/database/*`
- Modify: `apps/server/package.json`
- Create: `apps/server/tests/database.test.ts`

- [ ] **Step 1: Add database config**

```ts
// Input: ServerConfig
// Output: dbPath and dataDir for SQLite
// Position: infra database config

import { injectable } from 'tsyringe'

import { ServerConfig } from '../../core/config/server-config'

export interface DatabaseOptions {
  dbPath: string
  dataDir?: string
}

@injectable()
export class DatabaseConfig {
  constructor(private readonly config: ServerConfig) {}

  getOptions(): DatabaseOptions {
    const cfg = this.config.get()
    return { dbPath: cfg.dbPath, dataDir: cfg.dataDir }
  }
}
```

- [ ] **Step 2: Add database provider**

```ts
// Input: DatabaseConfig + @cradle/db schema
// Output: drizzle database singleton
// Position: infra database provider

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { injectable } from 'tsyringe'

import { dbSchema } from '@cradle/db'

import { DatabaseConfig } from './database.config'

@injectable()
export class DbProvider {
  private sqlite?: Database.Database
  private db?: BetterSQLite3Database<typeof dbSchema>

  constructor(private readonly config: DatabaseConfig) {}

  getDb(): BetterSQLite3Database<typeof dbSchema> {
    if (!this.db) {
      const { dbPath } = this.config.getOptions()
      this.sqlite = new Database(dbPath)
      this.sqlite.pragma('foreign_keys = ON')
      this.db = drizzle(this.sqlite, { schema: dbSchema })
    }
    return this.db
  }

  onApplicationShutdown(): void {
    this.sqlite?.close()
    this.sqlite = undefined
    this.db = undefined
  }
}
```

- [ ] **Step 3: Add migration runner**

```ts
// Input: DbProvider
// Output: migrations executed at module init
// Position: infra migration runner

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { injectable } from 'tsyringe'

import { getMigrationsPath } from '@cradle/db'

import { DbProvider } from './database.provider'

@injectable()
export class MigrationRunner {
  constructor(private readonly provider: DbProvider) {}

  onModuleInit(): void {
    const db = this.provider.getDb()
    migrate(db, { migrationsFolder: getMigrationsPath() })
  }
}
```

- [ ] **Step 4: Add db accessor**

```ts
// Input: DbProvider
// Output: db accessor
// Position: infra database accessor

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { injectable } from 'tsyringe'

import { dbSchema } from '@cradle/db'

import { DbProvider } from './database.provider'

@injectable()
export class DbAccessor {
  constructor(private readonly provider: DbProvider) {}

  get(): BetterSQLite3Database<typeof dbSchema> {
    return this.provider.getDb()
  }
}
```

- [ ] **Step 5: Add database module**

```ts
// Input: Database providers
// Output: DatabaseModule registration
// Position: infra database module

import { Module } from '@tsuki-hono/common'

import { DatabaseConfig } from './database.config'
import { DbAccessor } from './db-accessor'
import { DbProvider } from './database.provider'
import { MigrationRunner } from './migration-runner'

@Module({
  providers: [DatabaseConfig, DbProvider, MigrationRunner, DbAccessor],
})
export class DatabaseModule {}
```

- [ ] **Step 6: Add database README**

```md
<!--
Output: Infra database module inventory.
Input: DatabaseModule, providers, migrations.
Position: apps/server/src/infra/database
-->

# Database Module

SQLite lifecycle for the server runtime (connect → migrate → provide).

## Files

- **database.config.ts**: Reads db path from ServerConfig.
- **database.provider.ts**: SQLite + drizzle instance.
- **migration-runner.ts**: Runs migrations on module init.
- **db-accessor.ts**: Exposes `get()` for db usage.
- **database.module.ts**: Module registration.
```

- [ ] **Step 7: Add database test**

```ts
import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/infra/database/db-accessor'
import { sessions } from '@cradle/db'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('database module', () => {
  it('runs migrations on startup', async () => {
    const dataDir = makeTempDataDir()
    process.env.CRADLE_DATA_DIR = dataDir

    const app = await createConfiguredApp()
    const container = app.getContainer()

    const accessor = container.resolve(DbAccessor)
    const db = accessor.get()
    const rows = db.select().from(sessions).limit(1).all()
    expect(rows).toEqual([])

    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
    delete process.env.CRADLE_DATA_DIR
  })
})
```

- [ ] **Step 8: Add `@cradle/db` dependency**

```json
{
  "dependencies": {
    "@cradle/db": "workspace:*"
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/infra apps/server/tests/database.test.ts apps/server/package.json

git commit -m "feat(server): add database lifecycle module"
```

---

### Task 6: Wire CoreModule + InfraModule and fix failing tests

**Files:**
- Create: `apps/server/src/core/core.module.ts`, `apps/server/src/infra/infra.module.ts`
- Modify: `apps/server/src/app.module.ts`, `apps/server/src/app.factory.ts`, `apps/server/src/index.ts`
- Modify: `apps/server/tests/health.test.ts`

- [ ] **Step 1: Add CoreModule**

```ts
// Input: core providers and enhancers
// Output: CoreModule registration
// Position: server core module

import { APP_FILTER, APP_MIDDLEWARE, Module, type Constructor } from '@tsuki-hono/common'

import { ServerConfig } from './config/server-config'
import { AppExceptionFilter } from './errors/app-exception.filter'
import { HealthModule } from './health/health.module'
import { Logger } from './logging/logger'
import { RequestIdMiddleware } from './request/request-id.middleware'

@Module({
  imports: [HealthModule],
  providers: [
    ServerConfig,
    Logger,
    RequestIdMiddleware,
    AppExceptionFilter,
    { provide: APP_MIDDLEWARE as unknown as Constructor, useClass: RequestIdMiddleware },
    { provide: APP_FILTER as unknown as Constructor, useClass: AppExceptionFilter },
  ],
})
export class CoreModule {}
```

- [ ] **Step 2: Add InfraModule**

```ts
// Input: infra modules
// Output: InfraModule registration
// Position: server infra module

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from './database/database.module'

@Module({
  imports: [DatabaseModule],
})
export class InfraModule {}
```

- [ ] **Step 3: Update AppModule imports**

```ts
import { Module } from '@tsuki-hono/common'

import { CoreModule } from './core/core.module'
import { InfraModule } from './infra/infra.module'

@Module({
  imports: [CoreModule, InfraModule],
})
export class AppModule {}
```

- [ ] **Step 4: Update `app.factory.ts` to wire AppModule only**

```ts
import type { HonoHttpApplication } from '@tsuki-hono/core'
import { createApplication } from '@tsuki-hono/core'
import { Hono } from 'hono'

import { AppModule } from './app.module'

export async function createConfiguredApp(): Promise<HonoHttpApplication> {
  const hono = new Hono()
  const app = await createApplication(AppModule, {}, hono)

  return app
}
```

- [ ] **Step 5: Update `index.ts` to use config**

```ts
import 'reflect-metadata'

import { serve } from '@hono/node-server'

import { loadServerConfig } from './core/config/server-config'
import { createConfiguredApp } from './app.factory'

async function bootstrap() {
  const config = loadServerConfig()

  const app = await createConfiguredApp()
  const hono = app.getInstance()

  serve({
    fetch: hono.fetch,
    port: config.port,
    hostname: config.host,
  })

  console.log(`[cradle-server] listening on http://${config.host}:${config.port}`)
}

bootstrap().catch((err) => {
  console.error('[cradle-server] fatal bootstrap error:', err)
  process.exit(1)
})
```

- [ ] **Step 6: Update health test to set data dir**

```ts
import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-data-'))
}

describe('health module', () => {
  it('should respond to GET /health', async () => {
    const dataDir = makeTempDataDir()
    process.env.CRADLE_DATA_DIR = dataDir

    const app = await createConfiguredApp()
    const hono = app.getInstance()

    const res = await hono.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeTypeOf('number')

    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
    delete process.env.CRADLE_DATA_DIR
  })
})
```

- [ ] **Step 7: Run full server tests**

Run: `pnpm -C apps/server test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/server/src apps/server/tests

git commit -m "feat(server): wire core and infra foundation"
```

---

## Validation & Acceptance

- `pnpm -C apps/server test` passes.
- `pnpm -C apps/server typecheck` passes.
- Running server with `CRADLE_DATA_DIR` set starts and responds on `/health` with `x-request-id` header.

## Artifacts & Notes

- Design spec: `docs/superpowers/specs/2026-05-08-server-foundation-design.md`
- Plan file: `docs/superpowers/plans/2026-05-08-server-foundation-plan.md`
