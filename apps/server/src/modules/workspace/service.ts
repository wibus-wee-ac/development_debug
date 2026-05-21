import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

import type { Workspace } from '@cradle/db'
import { workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { listFiles, readTextFile, writeTextFile } from './files'

// ── helpers ──

const NON_ALPHA_RE = /[^A-Z]/g

function generateIdentifier(name: string): string {
  const base = name.slice(0, 3).toUpperCase().replace(NON_ALPHA_RE, 'X').padEnd(3, 'X')
  const existing = db().select({ identifier: workspaces.identifier }).from(workspaces).all().map(w => w.identifier)
  if (!existing.includes(base)) {
    return base
  }
  for (let i = 1; i <= 99; i++) {
    const candidate = `${base.slice(0, 2)}${i}`
    if (!existing.includes(candidate)) {
      return candidate
    }
  }
  return base
}

export function list(): Workspace[] {
  return db().select().from(workspaces).orderBy(workspaces.name).all()
}

export function get(id: string): Workspace | null {
  return db().select().from(workspaces).where(eq(workspaces.id, id)).get() ?? null
}

export function resolveByPath(path: string): Workspace | null {
  return db().select().from(workspaces).where(eq(workspaces.path, path)).get() ?? null
}

export function addFromDirectory(path: string): Workspace {
  return create({ name: basename(path), path })
}

export function create(input: { name: string, path: string }): Workspace {
  const id = randomUUID()
  const identifier = generateIdentifier(input.name)
  try {
    return db().insert(workspaces).values({ id, name: input.name, path: input.path, identifier }).returning().get()
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

export function update(input: { id: string, name: string }): Workspace | null {
  return db().update(workspaces).set({ name: input.name }).where(eq(workspaces.id, input.id)).returning().get() ?? null
}

export function remove(id: string): void {
  db().delete(workspaces).where(eq(workspaces.id, id)).run()
}

export async function getFiles(workspaceId: string) {
  const workspace = get(workspaceId)
  if (!workspace) {
    return []
  }
  return listFiles(workspace.path)
}

export async function getFileContent(workspaceId: string, relativePath: string): Promise<string | null> {
  const workspace = get(workspaceId)
  if (!workspace) {
    return null
  }
  return readTextFile(workspace.path, relativePath)
}

export async function setFileContent(workspaceId: string, relativePath: string, content: string): Promise<boolean> {
  const workspace = get(workspaceId)
  if (!workspace) {
    return false
  }
  return writeTextFile(workspace.path, relativePath, content)
}
