// Input: workspace capability HTTP endpoints
// Output: integration tests for workspace CRUD + file safety
// Position: apps/server/tests

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

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
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const createRes = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created.name).toBe(basename(workspaceRoot))
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      const explicitRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Manual Workspace', path: explicitWorkspaceRoot }),
      }))
      expect(explicitRes.status).toBe(200)
      const explicit = await explicitRes.json()
      expect(explicit.name).toBe('Manual Workspace')
      expect(explicit.createdAt).toBeTypeOf('number')
      expect(explicit.updatedAt).toBeTypeOf('number')

      const listRes = await app.handle(new Request('http://localhost/workspaces'))
      const list = await listRes.json()
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.id, path: workspaceRoot }),
        expect.objectContaining({ id: explicit.id, path: explicitWorkspaceRoot }),
      ]))

      const getRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`))
      const fetched = await getRes.json()
      expect(fetched).toEqual(expect.objectContaining({ id: created.id }))

      const missingGet = await app.handle(new Request('http://localhost/workspaces/missing-workspace'))
      expect(missingGet.status).toBe(200)
      expect(await missingGet.json()).toBeNull()

      const resolveRes = await app.handle(new Request(`http://localhost/workspaces/resolve?path=${encodeURIComponent(workspaceRoot)}`))
      const resolved = await resolveRes.json()
      expect(resolved).toEqual(expect.objectContaining({ id: created.id }))

      const updateRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Workspace' }),
      }))
      const updated = await updateRes.json()
      expect(updated).toEqual(expect.objectContaining({ name: 'Renamed Workspace' }))

      const missingUpdate = await app.handle(new Request('http://localhost/workspaces/missing-workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Missing' }),
      }))
      expect(missingUpdate.status).toBe(200)
      expect(await missingUpdate.json()).toBeNull()

      const duplicateRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dup', path: explicitWorkspaceRoot }),
      }))
      expect(duplicateRes.status).toBe(409)
      const duplicateBody = await duplicateRes.json()
      expect(duplicateBody.code).toBe('workspace_path_exists')

      const invalidRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }))
      expect(invalidRes.status).toBe(400)
      const invalidBody = await invalidRes.json()
      expect(invalidBody.code).toBe('validation_error')

      const invalidFromDirectory = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '' }),
      }))
      expect(invalidFromDirectory.status).toBe(400)

      const missingResolve = await app.handle(new Request('http://localhost/workspaces/resolve'))
      expect(missingResolve.status).toBe(400)

      const deleteRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, { method: 'DELETE' }))
      expect(deleteRes.status).toBe(200)
      const deleteBody = await deleteRes.json()
      expect(deleteBody).toEqual({ ok: true })

      const deleteExplicit = await app.handle(new Request(`http://localhost/workspaces/${explicit.id}`, { method: 'DELETE' }))
      expect(deleteExplicit.status).toBe(200)
      const deleteExplicitBody = await deleteExplicit.json()
      expect(deleteExplicitBody).toEqual({ ok: true })

      const afterList = await (await app.handle(new Request('http://localhost/workspaces'))).json()
      expect(afterList).toEqual([])
    }
    finally {
      shutdownInfra()
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
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

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

      app = await createServerApp()
      const createRes = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      const workspace = await createRes.json()

      const filesRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files`))
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

      const missingFiles = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files'))
      expect(await missingFiles.json()).toEqual([])

      const readRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('notes.md')}`))
      const readBody = await readRes.json()
      expect(readBody.content).toBe('# Notes\n')

      const blockedRead = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('../outside.md')}`))
      const blockedReadBody = await blockedRead.json()
      expect(blockedReadBody.content).toBeNull()

      const missingRead = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/content?path=notes.md'))
      const missingReadBody = await missingRead.json()
      expect(missingReadBody.content).toBeNull()

      const writeRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'updated text\n' }),
      }))
      const writeBody = await writeRes.json()
      expect(writeBody.success).toBe(true)
      expect(readFileSync(join(workspaceRoot, 'notes.md'), 'utf8')).toBe('updated text\n')

      const blockedWrite = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '../outside.md', content: 'bad\n' }),
      }))
      const blockedWriteBody = await blockedWrite.json()
      expect(blockedWriteBody.success).toBe(false)

      const missingWrite = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/content', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'bad\n' }),
      }))
      const missingWriteBody = await missingWrite.json()
      expect(missingWriteBody.success).toBe(false)
    }
    finally {
      shutdownInfra()
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
