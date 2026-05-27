// Focused coverage for external AI work import preview, persistence, and deduplication.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { externalWorkImportItems, messages, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-external-work-import-'))
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const app = await createServerApp({ startBackgroundTasks: false })
  return app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('external work import', () => {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    secret: process.env.CRADLE_CREDENTIAL_SECRET,
  }
  const tempDirs: string[] = []

  afterEach(() => {
    shutdownInfra()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    if (previous.dataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previous.dataDir
    }
    if (previous.secret === undefined) {
      delete process.env.CRADLE_CREDENTIAL_SECRET
    }
    else {
      process.env.CRADLE_CREDENTIAL_SECRET = previous.secret
    }
  })

  it('imports uploaded Claude session snapshots and deduplicates repeated imports', async () => {
    const dataDir = makeDataDir()
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const content = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Plan the import flow.' },
        timestamp: '2026-05-01T10:00:00.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-1',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Use preview, import, and dedupe.' },
        timestamp: '2026-05-01T10:00:01.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-1',
      }),
    ].join('\n')

    const previewResponse = await postJson('/external-work-import/upload-preview', {
      files: [{ sourceApp: 'claude', path: '/Users/test/.claude/projects/demo/session.jsonl', content }],
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      sourceApp: 'claude',
      sourceKind: 'session',
      importable: true,
      duplicate: false,
    })

    const importResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as {
      imported: number
      duplicates: number
      items: Array<{ sessionId: string | null }>
    }
    expect(imported.imported).toBe(1)
    expect(imported.duplicates).toBe(0)
    expect(imported.items[0]?.sessionId).toBeTruthy()

    const workspaceRows = db().select().from(workspaces).where(eq(workspaces.path, dataDir)).all()
    const sessionRows = db().select().from(sessions).all()
    const messageRows = db().select().from(messages).where(eq(messages.sessionId, imported.items[0]!.sessionId!)).all()
    const recordRows = db().select().from(externalWorkImportItems).all()
    expect(workspaceRows).toHaveLength(1)
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0]?.workspaceId).toBe(workspaceRows[0]?.id)
    expect(messageRows.map(row => row.content)).toEqual([
      'Plan the import flow.',
      'Use preview, import, and dedupe.',
    ])
    expect(recordRows).toHaveLength(1)

    const duplicateResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(duplicateResponse.status).toBe(200)
    const duplicate = await duplicateResponse.json() as { imported: number, duplicates: number }
    expect(duplicate.imported).toBe(0)
    expect(duplicate.duplicates).toBe(1)
    expect(db().select().from(sessions).all()).toHaveLength(1)
  })

  it('imports uploaded Codex settings without persisting secret fields', async () => {
    const dataDir = makeDataDir()
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const content = [
      'model = "gpt-5.1"',
      'model_reasoning_effort = "high"',
      'approval_policy = "never"',
      'api_key = "should-not-persist"',
    ].join('\n')

    const previewResponse = await postJson('/external-work-import/upload-preview', {
      files: [{ sourceApp: 'codex', path: '/Users/test/.codex/config.toml', content }],
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as {
      items: Array<{ payloadJson: string }>
    }
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]!.payloadJson).not.toContain('should-not-persist')

    const importResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(importResponse.status).toBe(200)

    const preferencesResponse = await (await createServerApp({ startBackgroundTasks: false }))
      .handle(new Request('http://localhost/preferences/chat'))
    expect(await preferencesResponse.json()).toMatchObject({
      modelId: 'gpt-5.1',
      configSelections: {
        reasoningEffort: 'high',
      },
    })

    const record = db().select().from(externalWorkImportItems).get()
    expect(record?.payloadJson).not.toContain('should-not-persist')
  })

  it('previews and records Codex migration categories from uploaded config and feature files', async () => {
    const dataDir = makeDataDir()
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const config = [
      'model = "gpt-5.1"',
      '[mcp_servers.filesystem]',
      'command = "node"',
      'args = ["server.js"]',
      '[hooks.pre_run]',
      'command = "pnpm lint"',
    ].join('\n')

    const previewResponse = await postJson('/external-work-import/upload-preview', {
      files: [
        { sourceApp: 'codex', path: '/Users/test/.codex/config.toml', content: config },
        { sourceApp: 'codex', path: '/Users/test/.codex/commands/review.md', content: 'Review the current diff.' },
        { sourceApp: 'codex', path: '/Users/test/.codex/subagents/planner.md', content: 'Plan multi-step work.' },
      ],
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as {
      items: Array<{ sourceKind: string, importable: boolean }>
    }
    expect(preview.items.map(item => item.sourceKind).sort()).toEqual([
      'command',
      'hook',
      'mcp',
      'settings',
      'subagent',
    ])
    expect(preview.items.every(item => item.importable)).toBe(true)

    const importResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as { imported: number, duplicates: number }
    expect(imported.imported).toBe(5)
    expect(imported.duplicates).toBe(0)

    const records = db().select().from(externalWorkImportItems).all()
    expect(records.map(record => record.sourceKind).sort()).toEqual([
      'command',
      'hook',
      'mcp',
      'settings',
      'subagent',
    ])
  })

  it('imports project instructions against matching workspaces from server and upload previews', async () => {
    const dataDir = makeDataDir()
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cradle-external-workspace-'))
    tempDirs.push(dataDir, workspaceDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    writeFileSync(join(workspaceDir, 'AGENTS.md'), 'Use Cradle project conventions.')

    const serverPreviewResponse = await postJson('/external-work-import/preview', {
      includeHome: false,
      cwds: [workspaceDir],
      sourceApps: ['codex'],
    })
    expect(serverPreviewResponse.status).toBe(200)
    const serverPreview = await serverPreviewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(serverPreview.items).toHaveLength(1)
    expect(serverPreview.items[0]).toMatchObject({
      sourceApp: 'codex',
      sourceKind: 'project',
      workspacePath: workspaceDir,
      importable: true,
    })

    const importResponse = await postJson('/external-work-import/import', {
      items: serverPreview.items,
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as {
      imported: number
      duplicates: number
      items: Array<{ workspaceId: string | null }>
    }
    expect(imported.imported).toBe(1)
    expect(imported.duplicates).toBe(0)
    expect(imported.items[0]?.workspaceId).toBeTruthy()

    const workspaceRows = db().select().from(workspaces).where(eq(workspaces.path, workspaceDir)).all()
    const recordRows = db().select().from(externalWorkImportItems).all()
    expect(workspaceRows).toHaveLength(1)
    expect(recordRows).toHaveLength(1)
    expect(recordRows[0]).toMatchObject({
      sourceKind: 'project',
      workspaceId: workspaceRows[0]?.id,
    })

    const uploadPreviewResponse = await postJson('/external-work-import/upload-preview', {
      files: [{
        sourceApp: 'codex',
        path: join(workspaceDir, 'AGENTS.md'),
        content: 'Use Cradle project conventions.',
        workspacePath: workspaceDir,
      }],
    })
    expect(uploadPreviewResponse.status).toBe(200)
    const uploadPreview = await uploadPreviewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(uploadPreview.items).toHaveLength(1)
    expect(uploadPreview.items[0]).toMatchObject({
      sourceApp: 'codex',
      sourceKind: 'project',
      workspacePath: workspaceDir,
      duplicate: true,
    })
  })
})
