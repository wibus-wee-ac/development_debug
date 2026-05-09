# Workspace Capability (Server Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the workspace capability for the Tsuki/Hono server: workspace CRUD, safe file listing, and safe text read/write endpoints.

**Architecture:** `WorkspaceModule` lives under `apps/server/src/capabilities/workspace`, composed of `WorkspaceController` (HTTP API), `WorkspaceService` (capability semantics), `WorkspaceStore` (DB access), and `WorkspaceFiles` (filesystem + ignore rules). Root `AppModule` imports a `CapabilitiesModule` that aggregates capability modules.

**Tech Stack:** TypeScript, Tsuki/Hono, Drizzle ORM (better-sqlite3), fast-glob, ignore, Vitest.

---

## File Map (Create/Modify)

**Create**
- `apps/server/src/capabilities/capabilities.module.ts`
- `apps/server/src/capabilities/workspace/README.md`
- `apps/server/src/capabilities/workspace/workspace.module.ts`
- `apps/server/src/capabilities/workspace/workspace.controller.ts`
- `apps/server/src/capabilities/workspace/workspace.service.ts`
- `apps/server/src/capabilities/workspace/workspace.store.ts`
- `apps/server/src/capabilities/workspace/workspace.files.ts`
- `apps/server/tests/workspace.test.ts`

**Modify**
- `apps/server/src/app.module.ts`
- `apps/server/src/capabilities/README.md`
- `apps/server/tests/README.md`
- `apps/server/package.json`
- `docs/superpowers/plans/README.md`

---

### Task 1: Add failing workspace capability tests

**Files:**
- Create: `apps/server/tests/workspace.test.ts`

- [ ] **Step 1: Write workspace capability tests (expected to fail initially)**

```ts
// Input: workspace capability HTTP endpoints
// Output: integration tests for workspace CRUD + file safety
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('workspace capability', () => {
  it('supports CRUD and resolveByPath', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const explicitWorkspaceRoot = makeTempDir('cradle-workspace-explicit-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()

      const createRes = await hono.request('/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      })
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created.name).toBe(basename(workspaceRoot))
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      const explicitRes = await hono.request('/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Manual Workspace', path: explicitWorkspaceRoot }),
      })
      expect(explicitRes.status).toBe(200)
      const explicit = await explicitRes.json()
      expect(explicit.name).toBe('Manual Workspace')
      expect(explicit.createdAt).toBeTypeOf('number')
      expect(explicit.updatedAt).toBeTypeOf('number')

      const listRes = await hono.request('/workspaces')
      const list = await listRes.json()
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.id, path: workspaceRoot }),
        expect.objectContaining({ id: explicit.id, path: explicitWorkspaceRoot }),
      ]))

      const getRes = await hono.request(`/workspaces/${created.id}`)
      const fetched = await getRes.json()
      expect(fetched).toEqual(expect.objectContaining({ id: created.id }))

      const missingGet = await hono.request('/workspaces/missing-workspace')
      const missingBody = await missingGet.json()
      expect(missingBody).toBeNull()

      const resolveRes = await hono.request(`/workspaces/resolve?path=${encodeURIComponent(workspaceRoot)}`)
      const resolved = await resolveRes.json()
      expect(resolved).toEqual(expect.objectContaining({ id: created.id }))

      const updateRes = await hono.request(`/workspaces/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Workspace' }),
      })
      const updated = await updateRes.json()
      expect(updated).toEqual(expect.objectContaining({ name: 'Renamed Workspace' }))

      const missingUpdate = await hono.request('/workspaces/missing-workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Missing' }),
      })
      const missingUpdateBody = await missingUpdate.json()
      expect(missingUpdateBody).toBeNull()

      const duplicateRes = await hono.request('/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dup', path: explicitWorkspaceRoot }),
      })
      expect(duplicateRes.status).toBe(409)
      const duplicateBody = await duplicateRes.json()
      expect(duplicateBody.code).toBe('workspace_path_exists')

      const invalidRes = await hono.request('/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(invalidRes.status).toBe(400)
      const invalidBody = await invalidRes.json()
      expect(invalidBody.code).toBe('invalid_workspace_input')

      const invalidFromDirectory = await hono.request('/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '' }),
      })
      expect(invalidFromDirectory.status).toBe(400)

      const missingResolve = await hono.request('/workspaces/resolve')
      expect(missingResolve.status).toBe(400)

      const deleteRes = await hono.request(`/workspaces/${created.id}`, { method: 'DELETE' })
      expect(deleteRes.status).toBe(200)
      const deleteBody = await deleteRes.json()
      expect(deleteBody).toEqual({ ok: true })

      const deleteExplicit = await hono.request(`/workspaces/${explicit.id}`, { method: 'DELETE' })
      expect(deleteExplicit.status).toBe(200)
      const deleteExplicitBody = await deleteExplicit.json()
      expect(deleteExplicitBody).toEqual({ ok: true })

      const afterList = await (await hono.request('/workspaces')).json()
      expect(afterList).toEqual([])
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(explicitWorkspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('lists files and enforces safe text IO', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      writeFileSync(join(workspaceRoot, '.gitignore'), 'ignored.txt\nignored-dir/\n', 'utf8')
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
      mkdirSync(join(workspaceRoot, '.git', 'objects'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'ignored-dir'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'src', 'main.ts'), 'console.log("hi")\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'notes.md'), '# Notes\n', 'utf8')
      writeFileSync(join(workspaceRoot, '.DS_Store'), 'ignored', 'utf8')
      writeFileSync(join(workspaceRoot, 'ignored.txt'), 'nope\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'ignored-dir', 'keep-out.md'), 'nope\n', 'utf8')
      writeFileSync(join(workspaceRoot, '.git', 'config'), '[core]\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n', 'utf8')

      app = await createConfiguredApp()
      const hono = app.getInstance()

      const createRes = await hono.request('/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      })
      const workspace = await createRes.json()

      const filesRes = await hono.request(`/workspaces/${workspace.id}/files`)
      const entries = await filesRes.json()
      expect(entries).toEqual(expect.arrayContaining([
        { type: 'directory', name: 'src', path: 'src' },
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
        { type: 'file', name: 'notes.md', path: 'notes.md' },
      ]))
      expect(entries.some((entry: { path: string }) => entry.path === 'ignored.txt')).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path.startsWith('ignored-dir'))).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path.startsWith('node_modules'))).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path.startsWith('.git'))).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path === '.DS_Store')).toBe(false)

      const missingFiles = await hono.request('/workspaces/missing-workspace/files')
      expect(await missingFiles.json()).toEqual([])

      const readRes = await hono.request(`/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('notes.md')}`)
      const readBody = await readRes.json()
      expect(readBody.content).toBe('# Notes\n')

      const blockedRead = await hono.request(`/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('../outside.md')}`)
      const blockedReadBody = await blockedRead.json()
      expect(blockedReadBody.content).toBeNull()

      const missingRead = await hono.request('/workspaces/missing-workspace/files/content?path=notes.md')
      const missingReadBody = await missingRead.json()
      expect(missingReadBody.content).toBeNull()

      const writeRes = await hono.request(`/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'updated text\n' }),
      })
      const writeBody = await writeRes.json()
      expect(writeBody.success).toBe(true)
      expect(readFileSync(join(workspaceRoot, 'notes.md'), 'utf8')).toBe('updated text\n')

      const blockedWrite = await hono.request(`/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '../outside.md', content: 'bad\n' }),
      })
      const blockedWriteBody = await blockedWrite.json()
      expect(blockedWriteBody.success).toBe(false)

      const missingWrite = await hono.request('/workspaces/missing-workspace/files/content', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'bad\n' }),
      })
      const missingWriteBody = await missingWrite.json()
      expect(missingWriteBody.success).toBe(false)
    }
    finally {
      if (app) {
        await app.close()
      }
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
```

- [ ] **Step 2: Run workspace tests (expected to fail)**

Run: `pnpm -C apps/server test -- --run tests/workspace.test.ts`
Expected: FAIL (workspace module not implemented yet)

- [ ] **Step 3: Commit tests**

```bash
git add apps/server/tests/workspace.test.ts
git commit -m "test(server): add workspace capability coverage"
```

---

### Task 2: Implement workspace capability module

**Files:**
- Create: `apps/server/src/capabilities/workspace/README.md`
- Create: `apps/server/src/capabilities/workspace/workspace.store.ts`
- Create: `apps/server/src/capabilities/workspace/workspace.files.ts`
- Create: `apps/server/src/capabilities/workspace/workspace.service.ts`
- Create: `apps/server/src/capabilities/workspace/workspace.controller.ts`
- Create: `apps/server/src/capabilities/workspace/workspace.module.ts`

- [ ] **Step 1: Add workspace module README**

```md
<!--
Output: Workspace capability module inventory.
Input: WorkspaceModule, service, store, file helpers.
Position: apps/server/src/capabilities/workspace.
-->

# Workspace Capability

Workspace CRUD and safe filesystem access (listing + text read/write).

## Files

- **workspace.module.ts**: Tsuki module registration.
- **workspace.controller.ts**: HTTP endpoints for workspace capability.
- **workspace.service.ts**: Capability semantics (CRUD + file ops).
- **workspace.store.ts**: Drizzle-backed workspace store.
- **workspace.files.ts**: `.gitignore` filtering and safe text IO.
```

- [ ] **Step 2: Add workspace store**

```ts
// Input: DbAccessor + workspace table
// Output: workspace CRUD store
// Position: workspace capability store

import { randomUUID } from 'node:crypto'

import { desc, eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { workspaces } from '@cradle/db'
import type { Workspace } from '@cradle/db'

import { DbAccessor } from '../../infra/database/db-accessor'

@injectable()
export class WorkspaceStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  list(): Workspace[] {
    return this.dbAccessor.get().select().from(workspaces).orderBy(desc(workspaces.createdAt)).all()
  }

  get(id: string): Workspace | undefined {
    return this.dbAccessor.get().select().from(workspaces).where(eq(workspaces.id, id)).get()
  }

  resolveByPath(path: string): Workspace | undefined {
    return this.dbAccessor.get().select().from(workspaces).where(eq(workspaces.path, path)).get()
  }

  create(input: { name: string; path: string }): Workspace {
    const id = randomUUID()
    return this.dbAccessor
      .get()
      .insert(workspaces)
      .values({ id, name: input.name, path: input.path })
      .returning()
      .get()
  }

  update(input: { id: string; name: string }): Workspace | undefined {
    const now = Math.floor(Date.now() / 1000)
    return this.dbAccessor
      .get()
      .update(workspaces)
      .set({ name: input.name, updatedAt: now })
      .where(eq(workspaces.id, input.id))
      .returning()
      .get()
  }

  delete(id: string): void {
    this.dbAccessor.get().delete(workspaces).where(eq(workspaces.id, id)).run()
  }
}
```

- [ ] **Step 3: Add workspace filesystem helper**

```ts
// Input: workspace path + relative paths
// Output: safe file listing + text read/write
// Position: workspace capability filesystem helper

import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

import fg from 'fast-glob'
import ignore from 'ignore'
import { injectable } from 'tsyringe'

export interface WorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

@injectable()
export class WorkspaceFiles {
  async listFiles(workspacePath: string): Promise<WorkspaceFileEntry[]> {
    const ig = ignore()
    try {
      ig.add(await readFile(join(workspacePath, '.gitignore'), 'utf8'))
    }
    catch {
      // Missing .gitignore is fine.
    }
    ig.add(['node_modules', '.git', '.DS_Store'])

    const entries = await fg('**/*', {
      cwd: workspacePath,
      dot: false,
      onlyFiles: false,
      markDirectories: true,
    })

    return entries
      .filter(ig.createFilter())
      .map((entry) => {
        const isDirectory = entry.endsWith('/')
        const cleanPath = isDirectory ? entry.slice(0, -1) : entry
        return {
          type: isDirectory ? 'directory' as const : 'file' as const,
          name: basename(cleanPath),
          path: cleanPath,
        }
      })
  }

  async readTextFile(workspacePath: string, relativePath: string): Promise<string | null> {
    const fullPath = this.resolveWorkspacePath(workspacePath, relativePath)
    if (!fullPath) {
      return null
    }
    try {
      return await readFile(fullPath, 'utf8')
    }
    catch {
      return null
    }
  }

  async writeTextFile(workspacePath: string, relativePath: string, content: string): Promise<boolean> {
    const fullPath = this.resolveWorkspacePath(workspacePath, relativePath)
    if (!fullPath) {
      return false
    }
    try {
      await writeFile(fullPath, content, 'utf8')
      return true
    }
    catch {
      return false
    }
  }

  private resolveWorkspacePath(workspacePath: string, relativePath: string): string | null {
    const resolvedWorkspace = resolve(workspacePath)
    const fullPath = resolve(resolvedWorkspace, relativePath)
    return this.isWithinRoot(resolvedWorkspace, fullPath) ? fullPath : null
  }

  private isWithinRoot(rootDir: string, targetPath: string): boolean {
    const normalizedRoot = resolve(rootDir)
    const normalizedTarget = resolve(targetPath)
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  }
}
```

- [ ] **Step 4: Add workspace service**

```ts
// Input: WorkspaceStore + WorkspaceFiles
// Output: workspace capability semantics
// Position: workspace capability service

import { basename } from 'node:path'

import { injectable } from 'tsyringe'

import type { Workspace } from '@cradle/db'

import { AppError } from '../../core/errors/app-error'
import { WorkspaceFiles, type WorkspaceFileEntry } from './workspace.files'
import { WorkspaceStore } from './workspace.store'

@injectable()
export class WorkspaceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly files: WorkspaceFiles
  ) {}

  list(): Workspace[] {
    return this.store.list()
  }

  get(id: string): Workspace | null {
    return this.store.get(id) ?? null
  }

  resolveByPath(path: string): Workspace | null {
    return this.store.resolveByPath(path) ?? null
  }

  addFromDirectory(path: string): Workspace {
    return this.create({ name: basename(path), path })
  }

  create(input: { name: string; path: string }): Workspace {
    try {
      return this.store.create(input)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('UNIQUE constraint failed: workspaces.path')) {
        throw new AppError({
          code: 'workspace_path_exists',
          status: 409,
          message: 'Workspace path already exists',
          details: { path: input.path },
        })
      }
      throw error
    }
  }

  update(input: { id: string; name: string }): Workspace | null {
    return this.store.update(input) ?? null
  }

  delete(id: string): void {
    this.store.delete(id)
  }

  async listFiles(workspaceId: string): Promise<WorkspaceFileEntry[]> {
    const workspace = this.store.get(workspaceId)
    if (!workspace) {
      return []
    }
    return this.files.listFiles(workspace.path)
  }

  async readTextFile(workspaceId: string, relativePath: string): Promise<string | null> {
    const workspace = this.store.get(workspaceId)
    if (!workspace) {
      return null
    }
    return this.files.readTextFile(workspace.path, relativePath)
  }

  async writeTextFile(workspaceId: string, relativePath: string, content: string): Promise<boolean> {
    const workspace = this.store.get(workspaceId)
    if (!workspace) {
      return false
    }
    return this.files.writeTextFile(workspace.path, relativePath, content)
  }
}
```

- [ ] **Step 5: Add workspace controller**

```ts
// Input: WorkspaceService
// Output: HTTP endpoints for workspace capability
// Position: workspace capability controller

import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

import { AppError } from '../../core/errors/app-error'
import { WorkspaceService } from './workspace.service'

type CreateWorkspaceInput = { name?: string; path?: string }
type UpdateWorkspaceInput = { name?: string }
type FileWriteInput = { path?: string; content?: string }

function ensureNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_workspace_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

@injectable()
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get('/')
  list() {
    return this.service.list()
  }

  @Get('/resolve')
  resolveByPath(@Query('path') path?: string) {
    const resolvedPath = ensureNonEmpty(path, 'path')
    return this.service.resolveByPath(resolvedPath)
  }

  @Get('/:id')
  get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('/')
  create(@Body() body: CreateWorkspaceInput) {
    const name = ensureNonEmpty(body.name, 'name')
    const path = ensureNonEmpty(body.path, 'path')
    return this.service.create({ name, path })
  }

  @Post('/from-directory')
  addFromDirectory(@Body() body: CreateWorkspaceInput) {
    const path = ensureNonEmpty(body.path, 'path')
    return this.service.addFromDirectory(path)
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateWorkspaceInput) {
    const name = ensureNonEmpty(body.name, 'name')
    return this.service.update({ id, name })
  }

  @Delete('/:id')
  remove(@Param('id') id: string) {
    this.service.delete(id)
    return { ok: true }
  }

  @Get('/:id/files')
  async listFiles(@Param('id') id: string) {
    return this.service.listFiles(id)
  }

  @Get('/:id/files/content')
  async readTextFile(@Param('id') id: string, @Query('path') path?: string) {
    const relativePath = ensureNonEmpty(path, 'path')
    const content = await this.service.readTextFile(id, relativePath)
    return { content }
  }

  @Put('/:id/files/content')
  async writeTextFile(@Param('id') id: string, @Body() body: FileWriteInput) {
    const path = ensureNonEmpty(body.path, 'path')
    const content = ensureNonEmpty(body.content, 'content')
    const success = await this.service.writeTextFile(id, path, content)
    return { success }
  }
}
```

- [ ] **Step 6: Add workspace module**

```ts
// Input: Workspace capability providers + controller
// Output: WorkspaceModule registration
// Position: workspace capability module

import { Module } from '@tsuki-hono/common'

import { WorkspaceController } from './workspace.controller'
import { WorkspaceFiles } from './workspace.files'
import { WorkspaceService } from './workspace.service'
import { WorkspaceStore } from './workspace.store'

@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceFiles, WorkspaceService, WorkspaceStore],
})
export class WorkspaceModule {}
```

- [ ] **Step 7: Run workspace tests (should still fail until wiring)**

Run: `pnpm -C apps/server test -- --run tests/workspace.test.ts`
Expected: FAIL (module not wired yet)

- [ ] **Step 8: Commit workspace module**

```bash
git add apps/server/src/capabilities/workspace
git commit -m "feat(server): add workspace capability module"
```

---

### Task 3: Wire capability module + update docs

**Files:**
- Create: `apps/server/src/capabilities/capabilities.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/capabilities/README.md`
- Modify: `apps/server/tests/README.md`

- [ ] **Step 1: Add capabilities module**

```ts
// Input: capability modules
// Output: CapabilitiesModule registration
// Position: server capabilities module

import { Module } from '@tsuki-hono/common'

import { WorkspaceModule } from './workspace/workspace.module'

@Module({
  imports: [WorkspaceModule],
})
export class CapabilitiesModule {}
```

- [ ] **Step 2: Wire CapabilitiesModule into AppModule**

```ts
import { Module } from '@tsuki-hono/common'

import { CapabilitiesModule } from './capabilities/capabilities.module'
import { CoreModule } from './core/core.module'
import { InfraModule } from './infra/infra.module'

@Module({
  imports: [CoreModule, InfraModule, CapabilitiesModule],
})
export class AppModule {}
```

- [ ] **Step 3: Update capabilities README**

```md
<!--
Output: Capability inventory for server migration.
Input: Capability modules under apps/server/src/capabilities.
Position: apps/server/src/capabilities index.
-->

# Capabilities

Server capability modules migrated from the legacy service layer.

## Modules

- **workspace**: Workspace CRUD + safe file listing/text IO.
```

- [ ] **Step 4: Update tests README**

```md
<!--
Output: apps/server test inventory.
Input: Vitest suites for server foundation and capabilities.
Position: apps/server/tests index.
-->

# Server Tests

## Files

- **config.test.ts**: server config parsing and validation.
- **request-id.test.ts**: request-id middleware behavior.
- **exception-filter.test.ts**: AppError normalization.
- **database.test.ts**: database lifecycle migrations.
- **health.test.ts**: health endpoint response.
- **workspace.test.ts**: workspace capability CRUD + file IO.
```

- [ ] **Step 5: Run workspace tests (should pass now)**

Run: `pnpm -C apps/server test -- --run tests/workspace.test.ts`
Expected: PASS

- [ ] **Step 6: Commit wiring + docs**

```bash
git add apps/server/src/app.module.ts apps/server/src/capabilities apps/server/tests/README.md
git commit -m "feat(server): wire workspace capability"
```

---

### Task 4: Add dependencies and update plan index

**Files:**
- Modify: `apps/server/package.json`
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add workspace dependencies**

```json
{
  "dependencies": {
    "fast-glob": "^3.3.3",
    "ignore": "^7.0.5"
  }
}
```

- [ ] **Step 2: Update plan index**

```md
- **2026-05-08-workspace-capability-plan.md**: Implementation plan for the workspace capability (CRUD + safe file IO).
```

- [ ] **Step 3: Commit dependency + docs updates**

```bash
git add apps/server/package.json docs/superpowers/plans/README.md
git commit -m "chore(server): add workspace capability deps"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full server tests**

Run: `pnpm -C apps/server test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm -C apps/server typecheck`
Expected: PASS

- [ ] **Step 3: Commit if needed**

```bash
git status --short
```

---

## Validation & Acceptance

- `pnpm -C apps/server test` passes.
- `pnpm -C apps/server typecheck` passes.
- Workspace endpoints return expected JSON and enforce safe file IO.

## Artifacts & Notes

- Capability spec: `apps/server/specs/capabilities/workspace.md`