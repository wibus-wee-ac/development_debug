# Database Capability (Server Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a SQLite-based DB capability for the Tsuki/Hono server with a dedicated `packages/db` schema package, auto-run migrations on startup, and a clean `DatabaseModule` providing accessors.

**Architecture:** `packages/db` owns schema + migrations; `apps/server` owns lifecycle via `DatabaseModule` (config → provider → migrator → accessor). Server startup fails fast if config/migrations fail. No request-scoped transaction context yet.

**Tech Stack:** TypeScript, Tsuki/Hono, Drizzle ORM (better-sqlite3), Vitest.

---

## File Map (Create/Modify)

**Create**
- `packages/db/package.json` — workspace package metadata + exports.
- `packages/db/README.md` — package inventory.
- `packages/db/src/index.ts` — public exports for schema + migration paths.
- `packages/db/src/paths.ts` — migrations path resolver.
- `packages/db/src/schema/*` — copied schema modules.
- `packages/db/drizzle/*` — migrated SQL + meta.
- `apps/server/src/modules/database/database.module.ts` — Tsuki module.
- `apps/server/src/modules/database/database.config.ts` — env config + dbPath.
- `apps/server/src/modules/database/database.provider.ts` — SQLite + drizzle instance.
- `apps/server/src/modules/database/migration-runner.ts` — onModuleInit migration runner.
- `apps/server/src/modules/database/db-accessor.ts` — accessor for drizzle instance.
- `apps/server/src/modules/database/README.md` — module inventory.
- `apps/server/tests/database.test.ts` — DB module tests.
- `.env` — placeholder for `CRADLE_DATA_DIR`.

**Modify**
- `drizzle.config.ts` — schema/migrations path updated to `packages/db`.
- `src/main/db/index.ts` — import schema/migrations from `@cradle/db`.
- `src/main/db/README.md` — updated ownership notes.
- `apps/server/src/app.module.ts` — add `DatabaseModule`.
- `apps/server/tests/health.test.ts` — set `CRADLE_DATA_DIR` for startup.
- `package.json` — add `@cradle/db` workspace dependency.
- `apps/server/package.json` — add `@cradle/db` workspace dependency.

**Delete**
- `src/main/db/schema/**` — removed after schema copy (imports updated).
- root `drizzle/` — moved to `packages/db/drizzle`.

---

### Task 1: Create `packages/db` package and schema copy

**Files:**
- Create: `packages/db/package.json`, `packages/db/README.md`, `packages/db/src/index.ts`, `packages/db/src/paths.ts`
- Copy: `src/main/db/schema/**` → `packages/db/src/schema/**`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@cradle/db",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./paths": "./src/paths.ts"
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

- [ ] **Step 2: Create `packages/db/README.md`**

```md
<!--
Output: DB schema package inventory for Cradle.
Input: Drizzle schema modules and migration artifacts.
Position: packages/db package index.
-->

# @cradle/db

Schema and migration artifacts for Cradle server persistence.

## Structure

- **src/index.ts**: Public exports for schema and migration paths.
- **src/paths.ts**: Helpers for resolving migration folder path.
- **src/schema/**: Drizzle schema modules.
- **drizzle/**: Drizzle migration SQL + meta.
```

- [ ] **Step 3: Copy schema directory**

```bash
mkdir -p packages/db/src/schema
cp -R src/main/db/schema/. packages/db/src/schema/
```

- [ ] **Step 4: Create `packages/db/src/index.ts`**

```ts
// Input: Drizzle schema modules and path helpers
// Output: Public schema exports and migration path helper
// Position: @cradle/db entrypoint for schema consumers

export * from './schema'
export * as dbSchema from './schema'
export { getMigrationsPath } from './paths'
```

- [ ] **Step 5: Create `packages/db/src/paths.ts`**

```ts
// Input: Node path utilities and module URL
// Output: Absolute migration folder path for @cradle/db
// Position: Path helpers for consumers that run migrations

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function getMigrationsPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  return join(currentDir, '..', 'drizzle')
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/db

git commit -m "feat(db): add db schema package"
```

---

### Task 2: Move migrations and update drizzle-kit config

**Files:**
- Move: `drizzle/` → `packages/db/drizzle/`
- Modify: `drizzle.config.ts`

- [ ] **Step 1: Move migration artifacts**

```bash
mkdir -p packages/db/drizzle
mv drizzle/* packages/db/drizzle/
rmdir drizzle
```

- [ ] **Step 2: Update `drizzle.config.ts`**

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './packages/db/src/schema/index.ts',
  out: './packages/db/drizzle',
  dialect: 'sqlite',
} satisfies Config
```

- [ ] **Step 3: Commit**

```bash
git add drizzle.config.ts packages/db/drizzle

git commit -m "chore(db): move migrations under packages/db"
```

---

### Task 3: Repoint main-process DB to `@cradle/db`

**Files:**
- Modify: `src/main/db/index.ts`, `src/main/db/README.md`
- Delete: `src/main/db/schema/**`
- Modify: any imports referencing `src/main/db/schema`
- Modify: `package.json` (add `@cradle/db` dependency)

- [ ] **Step 1: Update `src/main/db/index.ts` to use `@cradle/db`**

```ts
// Input: better-sqlite3, Drizzle schema/migrator, Electron runtime path helpers
// Output: initDb and getDb helpers for the main-process SQLite database singleton
// Position: Persistence bootstrap and database accessor for the Electron main process

import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { dbSchema, getMigrationsPath } from '@cradle/db'

let db: BetterSQLite3Database<typeof dbSchema> | null = null

export function initDb(dbPath: string): void {
  const sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema: dbSchema })

  migrate(db, { migrationsFolder: getMigrationsPath() })
}

export function getDb(): BetterSQLite3Database<typeof dbSchema> {
  if (!db) {
    throw new Error('Database is not initialised — call initDb() first.')
  }
  return db
}
```

- [ ] **Step 2: Update any schema imports**

Search and replace any imports that target `src/main/db/schema` or relative `./schema` usage to `@cradle/db` exports (for table types, use named exports from `@cradle/db`).

```bash
rg "db/schema|/schema'" src
```

Example pattern:

```ts
- import { sessions } from './db/schema'
+ import { sessions } from '@cradle/db'
```

- [ ] **Step 3: Remove old schema folder**

```bash
rm -rf src/main/db/schema
```

- [ ] **Step 4: Update `src/main/db/README.md`**

```md
<!-- Once this directory changes, update this README.md -->

# src/main/db

SQLite persistence bootstrap for the Electron main process.
The durable schema now lives in `packages/db`, and this module only initializes
connections and runs migrations from the shared package.

## Files

- **index.ts**: Initializes the Better SQLite database, enables SQLite pragmas, and runs Drizzle migrations
```

- [ ] **Step 5: Add `@cradle/db` dependency in root `package.json`**

```json
{
  "dependencies": {
    "@cradle/db": "workspace:*"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/main/db package.json

git commit -m "refactor(db): consume shared db schema"
```

---

### Task 4: Add DB module tests (failing first)

**Files:**
- Create: `apps/server/tests/database.test.ts`
- Modify: `apps/server/tests/health.test.ts`

- [ ] **Step 1: Add DB module test (expected to fail)**

```ts
import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/modules/database/db-accessor'
import { sessions } from '@cradle/db'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-db-'))
}

describe('database module', () => {
  it('runs migrations on startup and exposes db access', async () => {
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

- [ ] **Step 2: Update `apps/server/tests/health.test.ts` to set `CRADLE_DATA_DIR`**

```ts
import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-db-'))
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

- [ ] **Step 3: Run tests (should fail)**

Run: `pnpm -C apps/server test`
Expected: FAIL (DatabaseModule not implemented yet).

---

### Task 5: Implement `DatabaseModule` and make tests pass

**Files:**
- Create: `apps/server/src/modules/database/*`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/package.json` (add `@cradle/db` dependency)
- Create: `apps/server/src/modules/database/README.md`

- [ ] **Step 1: Create `database.config.ts`**

```ts
// Input: process.env + filesystem
// Output: validated DB options (dataDir, dbPath)
// Position: Server database configuration for SQLite lifecycle

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { injectable } from 'tsyringe'

export interface DatabaseOptions {
  dataDir: string
  dbPath: string
}

@injectable()
export class DatabaseConfig {
  getOptions(): DatabaseOptions {
    const dataDir = process.env.CRADLE_DATA_DIR?.trim()
    if (!dataDir) {
      throw new Error('CRADLE_DATA_DIR is required for SQLite storage')
    }

    mkdirSync(dataDir, { recursive: true })

    return {
      dataDir,
      dbPath: join(dataDir, 'cradle.db'),
    }
  }
}
```

- [ ] **Step 2: Create `database.provider.ts`**

```ts
// Input: DatabaseConfig and @cradle/db schema
// Output: Singleton drizzle database instance
// Position: SQLite provider for server database module

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

- [ ] **Step 3: Create `migration-runner.ts`**

```ts
// Input: DbProvider and migration path
// Output: Drizzle migrations executed at module init
// Position: Auto-migration runner for server startup

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

- [ ] **Step 4: Create `db-accessor.ts`**

```ts
// Input: DbProvider
// Output: Accessor for drizzle database instance
// Position: Database accessor for server modules

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

- [ ] **Step 5: Create `database.module.ts`**

```ts
// Input: Database providers and config
// Output: Tsuki database module registration
// Position: Server database module boundary

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

- [ ] **Step 6: Add module README**

```md
<!--
Output: Server database module inventory.
Input: DatabaseModule, config, provider, migrator, accessor.
Position: apps/server/src/modules/database
-->

# Database Module

Server-side SQLite lifecycle for Cradle. Runs migrations on startup and exposes a drizzle accessor.

## Files

- **database.module.ts**: Tsuki module registration.
- **database.config.ts**: Reads `CRADLE_DATA_DIR` and builds db path.
- **database.provider.ts**: SQLite + drizzle singleton provider.
- **migration-runner.ts**: Runs migrations on module init.
- **db-accessor.ts**: Exposes `get()` for db access.
```

- [ ] **Step 7: Update `apps/server/src/app.module.ts`**

```ts
import { Module } from '@tsuki-hono/common'

import { HealthModule } from './modules/health/health.module'
import { DatabaseModule } from './modules/database/database.module'

@Module({
  imports: [DatabaseModule, HealthModule],
})
export class AppModule {}
```

- [ ] **Step 8: Add `@cradle/db` dependency in `apps/server/package.json`**

```json
{
  "dependencies": {
    "@cradle/db": "workspace:*"
  }
}
```

- [ ] **Step 9: Run tests (should pass)**

Run: `pnpm -C apps/server test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/server

git commit -m "feat(server): add database module"
```

---

### Task 6: Add runtime env placeholder

**Files:**
- Create: `.env`

- [ ] **Step 1: Create `.env`**

```env
# Cradle server runtime
CRADLE_DATA_DIR=/absolute/path/to/cradle-data
```

- [ ] **Step 2: Commit**

```bash
git add .env

git commit -m "chore(env): add CRADLE_DATA_DIR placeholder"
```

---

## Validation & Acceptance

- `pnpm -C apps/server test` passes.
- `pnpm typecheck:node` passes (ensures main-process import changes are valid).
- Starting server with `CRADLE_DATA_DIR` set creates `cradle.db` and runs migrations without errors.

## Idempotence & Recovery

- Re-running migrations is safe (drizzle tracks applied migrations).
- If migration fails, fix SQL in `packages/db/drizzle` and re-run server start.
- If DB path is wrong, delete the broken DB file and restart after fixing `CRADLE_DATA_DIR`.

## Artifacts & Notes

- Design spec: `docs/superpowers/specs/2026-05-07-database-capability-design.md`
- Plan file: `docs/superpowers/plans/2026-05-07-database-capability-plan.md`
