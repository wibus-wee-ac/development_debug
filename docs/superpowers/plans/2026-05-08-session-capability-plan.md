# Session Capability (Server Migration) Implementation Plan

> Historical note (2026-05-16): this implementation plan targets an earlier Tsuki/Hono migration stage and still references timeline extraction / `backendTimelineEvents`. The current canonical session/chat contract uses `messages.messageJson` for snapshot hydration, `messages.content` for derived plain-text export/search, and sequenced SSE delta events for live updates.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the session capability for the Tsuki/Hono server: session CRUD, pin toggle, message read, markdown export, and delete cleanup hook.

**Architecture:** `SessionModule` lives under `apps/server/src/capabilities/session`, composed of `SessionController` (HTTP API), `SessionService` (capability semantics + cleanup hook), `SessionStore` (DB access), `SessionExport` (markdown + timeline extraction), and `SessionCleanup` (no-op adapter for future pty/search integration). Root `CapabilitiesModule` aggregates `SessionModule`.

**Tech Stack:** TypeScript, Tsuki/Hono, Drizzle ORM (better-sqlite3), Vitest.

---

## File Map (Create/Modify)

**Create**
- `apps/server/src/capabilities/session/README.md`
- `apps/server/src/capabilities/session/session.module.ts`
- `apps/server/src/capabilities/session/session.controller.ts`
- `apps/server/src/capabilities/session/session.service.ts`
- `apps/server/src/capabilities/session/session.store.ts`
- `apps/server/src/capabilities/session/session.export.ts`
- `apps/server/src/capabilities/session/session.cleanup.ts`
- `apps/server/tests/session.test.ts`

**Modify**
- `apps/server/src/capabilities/capabilities.module.ts`
- `apps/server/src/capabilities/README.md`
- `apps/server/tests/README.md`
- `docs/superpowers/plans/README.md`

---

### Task 1: Add failing session capability tests

**Files:**
- Create: `apps/server/tests/session.test.ts`

- [ ] **Step 1: Write session capability tests (expected to fail initially)**

```ts
// Input: session capability HTTP endpoints
// Output: integration tests for session CRUD, messages, and export
// Position: apps/server/tests

import 'reflect-metadata'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentProfiles,
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
  workspaces,
} from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'
import { DbAccessor } from '../src/infra/database/db-accessor'

const TIMELINE_SCHEMA_VERSION = 'cradle.timeline.v1'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('session capability', () => {
  it('supports CRUD, pin toggle, messages, and export', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createConfiguredApp>> | undefined

    try {
      app = await createConfiguredApp()
      const hono = app.getInstance()
      const container = app.getContainer()
      const accessor = container.resolve(DbAccessor) as DbAccessor
      const db = accessor.get()

      const workspaceId = randomUUID()
      const agentProfileId = randomUUID()
      db.insert(workspaces).values({
        id: workspaceId,
        name: 'Workspace',
        path: workspaceRoot,
      }).run()
      db.insert(agentProfiles).values({
        id: agentProfileId,
        name: 'Test Agent',
        providerKind: 'openai-compatible',
      }).run()

      const sessionId = randomUUID()
      const createRes = await hono.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: sessionId,
          workspaceId,
          title: 'Chat',
          agentProfileId,
        }),
      })
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created).toEqual(expect.objectContaining({
        id: sessionId,
        workspaceId,
        title: 'Chat',
        agentProfileId,
      }))
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      const listRes = await hono.request(`/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      const list = await listRes.json()
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: sessionId }),
      ]))

      const getRes = await hono.request(`/sessions/${sessionId}`)
      expect(await getRes.json()).toEqual(expect.objectContaining({ id: sessionId }))

      const missingGet = await hono.request('/sessions/missing')
      expect(await missingGet.json()).toBeNull()

      const updateRes = await hono.request(`/sessions/${sessionId}/title`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed Chat' }),
      })
      expect(updateRes.status).toBe(200)
      expect(await updateRes.json()).toEqual({ ok: true })

      const updated = await (await hono.request(`/sessions/${sessionId}`)).json()
      expect(updated.title).toBe('Renamed Chat')

      const pinRes = await hono.request(`/sessions/${sessionId}/toggle-pin`, { method: 'POST' })
      expect(await pinRes.json()).toEqual({ pinned: true })

      const unpinRes = await hono.request(`/sessions/${sessionId}/toggle-pin`, { method: 'POST' })
      expect(await unpinRes.json()).toEqual({ pinned: false })

      const missingPin = await hono.request('/sessions/missing/toggle-pin', { method: 'POST' })
      expect(await missingPin.json()).toEqual({ pinned: false })

      const userMessageId = randomUUID()
      const assistantMessageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)
      db.insert(messages).values([
        {
          id: userMessageId,
          sessionId,
          role: 'user',
          status: 'complete',
          content: 'Hello',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          status: 'complete',
          content: 'Fallback',
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ]).run()

      const messagesRes = await hono.request(`/sessions/${sessionId}/messages`)
      const msgs = await messagesRes.json()
      expect(msgs).toEqual([
        expect.objectContaining({ id: userMessageId, role: 'user' }),
        expect.objectContaining({ id: assistantMessageId, role: 'assistant' }),
      ])

      const bindingId = randomUUID()
      db.insert(backendSessionBindings).values({
        id: bindingId,
        chatSessionId: sessionId,
        agentProfileId,
        providerKind: 'openai-compatible',
        requestedModelId: 'gpt-test',
      }).run()

      const runId = randomUUID()
      db.insert(backendRuns).values({
        id: runId,
        bindingId,
        chatSessionId: sessionId,
        messageId: assistantMessageId,
        origin: 'user',
        status: 'complete',
        startedAt: now,
        finishedAt: now + 1,
      }).run()

      const sourceJson = JSON.stringify({
        backend: 'openai-compatible',
        eventType: 'response',
        eventId: null,
        itemId: null,
      })
      db.insert(backendTimelineEvents).values([
        {
          id: randomUUID(),
          runId,
          chatSessionId: sessionId,
          sequenceNumber: 1,
          eventType: 'assistant.text.delta',
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: JSON.stringify({ itemId: 'item-1', delta: 'Hello ' }),
          sourceJson,
          createdAt: now,
        },
        {
          id: randomUUID(),
          runId,
          chatSessionId: sessionId,
          sequenceNumber: 2,
          eventType: 'assistant.text.delta',
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: JSON.stringify({ itemId: 'item-1', delta: 'world' }),
          sourceJson,
          createdAt: now + 1,
        },
      ]).run()

      const exportRes = await hono.request(`/sessions/${sessionId}/export/markdown`)
      const exportBody = await exportRes.json()
      expect(exportBody.markdown).toContain('# Renamed Chat')
      expect(exportBody.markdown).toContain('Model: gpt-test')
      expect(exportBody.markdown).toContain('## User')
      expect(exportBody.markdown).toContain('Hello')
      expect(exportBody.markdown).toContain('## Assistant')
      expect(exportBody.markdown).toContain('Hello world')

      const invalidCreate = await hono.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      })
      expect(invalidCreate.status).toBe(400)
      const invalidBody = await invalidCreate.json()
      expect(invalidBody.code).toBe('invalid_session_input')

      const deleteRes = await hono.request(`/sessions/${sessionId}`, { method: 'DELETE' })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      const afterList = await (await hono.request(`/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)).json()
      expect(afterList).toEqual([])
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

- [ ] **Step 2: Run session tests (expected to fail)**

Run: `pnpm -C apps/server test -- --run tests/session.test.ts`
Expected: FAIL (session module not implemented yet)

- [ ] **Step 3: Commit tests**

```bash
git add apps/server/tests/session.test.ts
git commit -m "test(server): add session capability coverage"
```

---

### Task 2: Implement session capability module

**Files:**
- Create: `apps/server/src/capabilities/session/README.md`
- Create: `apps/server/src/capabilities/session/session.store.ts`
- Create: `apps/server/src/capabilities/session/session.export.ts`
- Create: `apps/server/src/capabilities/session/session.cleanup.ts`
- Create: `apps/server/src/capabilities/session/session.service.ts`
- Create: `apps/server/src/capabilities/session/session.controller.ts`
- Create: `apps/server/src/capabilities/session/session.module.ts`

- [ ] **Step 1: Add session module README**

```md
<!--
Output: Session capability module inventory.
Input: SessionModule, service, store, export helper.
Position: apps/server/src/capabilities/session.
-->

# Session Capability

Session CRUD, pin toggle, message read, and markdown export.

## Files

- **session.module.ts**: Tsuki module registration.
- **session.controller.ts**: HTTP endpoints for session capability.
- **session.service.ts**: Capability semantics (CRUD + export + cleanup).
- **session.store.ts**: Drizzle-backed session store.
- **session.export.ts**: Markdown export + timeline text extraction.
- **session.cleanup.ts**: Cleanup adapter (no-op for now).
```

- [ ] **Step 2: Add session store**

```ts
// Input: DbAccessor + session/message tables
// Output: session CRUD store
// Position: session capability store

import { randomUUID } from 'node:crypto'

import { desc, eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { messages, sessions } from '@cradle/db'
import type { Message, Session } from '@cradle/db'

import { DbAccessor } from '../../infra/database/db-accessor'

@injectable()
export class SessionStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  list(workspaceId: string): Session[] {
    return this.dbAccessor
      .get()
      .select()
      .from(sessions)
      .where(eq(sessions.workspaceId, workspaceId))
      .orderBy(desc(sessions.updatedAt))
      .all()
  }

  get(id: string): Session | undefined {
    return this.dbAccessor.get().select().from(sessions).where(eq(sessions.id, id)).get()
  }

  create(input: { id?: string; workspaceId: string; title: string; agentProfileId: string }): Session {
    const id = input.id ?? randomUUID()
    return this.dbAccessor
      .get()
      .insert(sessions)
      .values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        agentProfileId: input.agentProfileId,
      })
      .returning()
      .get()
  }

  updateTitle(input: { id: string; title: string }): void {
    const now = Math.floor(Date.now() / 1000)
    this.dbAccessor
      .get()
      .update(sessions)
      .set({ title: input.title, updatedAt: now })
      .where(eq(sessions.id, input.id))
      .run()
  }

  delete(id: string): void {
    this.dbAccessor.get().delete(sessions).where(eq(sessions.id, id)).run()
  }

  getMessages(sessionId: string): Message[] {
    return this.dbAccessor
      .get()
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()
  }

  togglePin(id: string): boolean {
    const db = this.dbAccessor.get()
    const session = db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!session) {
      return false
    }
    const newPinned = session.pinned ? 0 : 1
    db.update(sessions).set({ pinned: newPinned }).where(eq(sessions.id, id)).run()
    return newPinned === 1
  }
}
```

- [ ] **Step 3: Add session cleanup adapter**

```ts
// Input: session delete events
// Output: cleanup hook for future pty/search integration
// Position: session capability cleanup adapter

import { injectable } from 'tsyringe'

@injectable()
export class SessionCleanup {
  onSessionDeleted(_sessionId: string): void {
    // No-op until pty/search capabilities are migrated.
  }
}
```

- [ ] **Step 4: Add session export helper**

```ts
// Input: DbAccessor + session/message/timeline tables
// Output: markdown export for a session
// Position: session capability export helper

import { desc, eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import {
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
} from '@cradle/db'

import { DbAccessor } from '../../infra/database/db-accessor'

@injectable()
export class SessionExport {
  constructor(private readonly dbAccessor: DbAccessor) {}

  exportMarkdown(sessionId: string): string {
    const db = this.dbAccessor.get()
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!session) {
      return ''
    }

    const msgs = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()

    const binding = db
      .select()
      .from(backendSessionBindings)
      .where(eq(backendSessionBindings.chatSessionId, sessionId))
      .get()

    const lines: string[] = []
    lines.push(`# ${session.title}`)
    lines.push('')
    lines.push(`> Model: ${binding?.requestedModelId ?? 'unknown'} | Created: ${new Date(session.createdAt * 1000).toLocaleString()}`)
    lines.push('')

    for (const msg of msgs) {
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      lines.push(`## ${role}`)
      lines.push('')
      if (msg.role === 'assistant') {
        lines.push(this.extractAssistantMarkdownText(db, msg.id, msg.content))
      }
      else {
        lines.push(msg.content)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  private extractAssistantMarkdownText(
    db: ReturnType<DbAccessor['get']>,
    messageId: string,
    fallbackContent: string,
  ): string {
    const run = db
      .select({ id: backendRuns.id })
      .from(backendRuns)
      .where(eq(backendRuns.messageId, messageId))
      .orderBy(desc(backendRuns.startedAt))
      .get()

    if (!run) {
      return fallbackContent
    }

    const rows = db
      .select({ eventType: backendTimelineEvents.eventType, payloadJson: backendTimelineEvents.payloadJson })
      .from(backendTimelineEvents)
      .where(eq(backendTimelineEvents.runId, run.id))
      .orderBy(backendTimelineEvents.sequenceNumber)
      .all()

    const text = rows
      .filter(row => row.eventType === 'assistant.text.delta')
      .map(row => safeParseDelta(row.payloadJson))
      .join('')

    return text || fallbackContent
  }
}

function safeParseDelta(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as { delta?: string }
    return typeof parsed.delta === 'string' ? parsed.delta : ''
  }
  catch {
    return ''
  }
}
```

- [ ] **Step 5: Add session service**

```ts
// Input: SessionStore + SessionExport + SessionCleanup
// Output: session capability semantics
// Position: session capability service

import { injectable } from 'tsyringe'

import type { Message, Session } from '@cradle/db'

import { SessionCleanup } from './session.cleanup'
import { SessionExport } from './session.export'
import { SessionStore } from './session.store'

@injectable()
export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly exporter: SessionExport,
    private readonly cleanup: SessionCleanup,
  ) {}

  list(workspaceId: string): Session[] {
    return this.store.list(workspaceId)
  }

  get(id: string): Session | null {
    return this.store.get(id) ?? null
  }

  create(input: { id?: string; workspaceId: string; title: string; agentProfileId: string }): Session {
    return this.store.create(input)
  }

  updateTitle(input: { id: string; title: string }): void {
    this.store.updateTitle(input)
  }

  delete(id: string): void {
    this.cleanup.onSessionDeleted(id)
    this.store.delete(id)
  }

  togglePin(id: string): boolean {
    return this.store.togglePin(id)
  }

  getMessages(sessionId: string): Message[] {
    return this.store.getMessages(sessionId)
  }

  exportMarkdown(sessionId: string): string {
    return this.exporter.exportMarkdown(sessionId)
  }
}
```

- [ ] **Step 6: Add session controller**

```ts
// Input: SessionService
// Output: HTTP endpoints for session capability
// Position: session capability controller

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

import { AppError } from '../../core/errors/app-error'
import { SessionService } from './session.service'

type CreateSessionInput = { workspaceId?: string; title?: string; agentProfileId?: string; id?: string }
type UpdateTitleInput = { title?: string }

function ensureNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

@injectable()
@Controller('sessions')
export class SessionController {
  constructor(private readonly service: SessionService) {}

  @Get('/')
  list(@Query('workspaceId') workspaceId?: string) {
    const resolvedWorkspaceId = ensureNonEmpty(workspaceId, 'workspaceId')
    return this.service.list(resolvedWorkspaceId)
  }

  @Get('/:id')
  get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('/')
  create(@Body() body: CreateSessionInput) {
    const workspaceId = ensureNonEmpty(body.workspaceId, 'workspaceId')
    const title = ensureNonEmpty(body.title, 'title')
    const agentProfileId = ensureNonEmpty(body.agentProfileId, 'agentProfileId')
    return this.service.create({ id: body.id, workspaceId, title, agentProfileId })
  }

  @Patch('/:id/title')
  updateTitle(@Param('id') id: string, @Body() body: UpdateTitleInput) {
    const title = ensureNonEmpty(body.title, 'title')
    this.service.updateTitle({ id, title })
    return { ok: true }
  }

  @Delete('/:id')
  remove(@Param('id') id: string) {
    this.service.delete(id)
    return { ok: true }
  }

  @Post('/:id/toggle-pin')
  togglePin(@Param('id') id: string) {
    const pinned = this.service.togglePin(id)
    return { pinned }
  }

  @Get('/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.service.getMessages(id)
  }

  @Get('/:id/export/markdown')
  exportMarkdown(@Param('id') id: string) {
    return { markdown: this.service.exportMarkdown(id) }
  }
}
```

- [ ] **Step 7: Add session module**

```ts
// Input: Session capability providers + controller
// Output: SessionModule registration
// Position: session capability module

import { Module } from '@tsuki-hono/common'

import { SessionCleanup } from './session.cleanup'
import { SessionController } from './session.controller'
import { SessionExport } from './session.export'
import { SessionService } from './session.service'
import { SessionStore } from './session.store'

@Module({
  controllers: [SessionController],
  providers: [SessionCleanup, SessionExport, SessionService, SessionStore],
})
export class SessionModule {}
```

- [ ] **Step 8: Run session tests (should still fail until wiring)**

Run: `pnpm -C apps/server test -- --run tests/session.test.ts`
Expected: FAIL (module not wired yet)

- [ ] **Step 9: Commit session module**

```bash
git add apps/server/src/capabilities/session
git commit -m "feat(server): add session capability module"
```

---

### Task 3: Wire session capability + update docs

**Files:**
- Modify: `apps/server/src/capabilities/capabilities.module.ts`
- Modify: `apps/server/src/capabilities/README.md`
- Modify: `apps/server/tests/README.md`
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Wire SessionModule into CapabilitiesModule**

```ts
import { Module } from '@tsuki-hono/common'

import { SessionModule } from './session/session.module'
import { WorkspaceModule } from './workspace/workspace.module'

@Module({
  imports: [WorkspaceModule, SessionModule],
})
export class CapabilitiesModule {}
```

- [ ] **Step 2: Update capabilities README**

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
- **session**: Session CRUD, pin toggle, message read, markdown export.
```

- [ ] **Step 3: Update tests README**

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
- **session.test.ts**: session capability CRUD + messages + markdown export.
```

- [ ] **Step 4: Update plan index**

```md
- **2026-05-08-session-capability-plan.md**: Implementation plan for the session capability (CRUD + messages + markdown export).
```

- [ ] **Step 5: Run session tests (should pass now)**

Run: `pnpm -C apps/server test -- --run tests/session.test.ts`
Expected: PASS

- [ ] **Step 6: Commit wiring + docs**

```bash
git add apps/server/src/capabilities apps/server/tests/README.md docs/superpowers/plans/README.md
git commit -m "feat(server): wire session capability"
```

---

### Task 4: Final verification

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
- Session endpoints return expected JSON and export Markdown with timeline deltas.

## Artifacts & Notes

- Capability spec: `apps/server/specs/capabilities/session.md`
