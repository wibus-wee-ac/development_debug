import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { Workspace } from '@cradle/db'
import { workspaces } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db, getServerConfig } from '../../infra'
import {
  createDirectory,
  createEmptyFile,
  createWorkspaceFileWriteBoundary,
  getWorkspaceFileInfo,
  listFiles,
  readTextFile,
  readWorkspaceFileBytes,
  renameWorkspacePath,
  renderWorkspaceFilePdf,
  writeTextFile,
} from './files'

// ── helpers ──

const NON_ALPHA_RE = /[^A-Z]/g
const AD_HOC_WORKSPACE_ROOT_ENV = 'CRADLE_AD_HOC_WORKSPACE_ROOT'

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
  return db().select().from(workspaces).orderBy(desc(workspaces.pinned), workspaces.name).all()
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

export function createAdHocWorkspace(input: { now?: Date } = {}): Workspace {
  const now = input.now ?? new Date()
  const dateSegment = formatLocalDate(now)
  const workspaceId = randomUUID()
  const path = join(resolveAdHocWorkspaceRoot(), dateSegment, `${formatDateTimeId(now)}-${workspaceId}`)
  mkdirSync(path, { recursive: true })

  return create({
    name: `Chat ${dateSegment}`,
    path,
  })
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

export function update(input: { id: string, name?: string, pinned?: boolean }): Workspace | null {
  const record = get(input.id)
  if (!record) {
    return null
  }

  const patch: Partial<typeof workspaces.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  }

  if (input.name !== undefined) {
    patch.name = input.name
  }
  if (input.pinned !== undefined) {
    patch.pinned = input.pinned ? 1 : 0
  }

  return db().update(workspaces).set(patch).where(eq(workspaces.id, input.id)).returning().get() ?? null
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

export async function getFileInfo(workspaceId: string, relativePath: string) {
  const workspace = get(workspaceId)
  if (!workspace) {
    return null
  }
  return getWorkspaceFileInfo(workspace.path, relativePath)
}

export async function getFileBytes(workspaceId: string, relativePath: string) {
  const workspace = get(workspaceId)
  if (!workspace) {
    return null
  }
  const info = await getWorkspaceFileInfo(workspace.path, relativePath)
  if (!info) {
    return null
  }
  const bytes = await readWorkspaceFileBytes(workspace.path, relativePath)
  if (!bytes) {
    return null
  }
  return { info, bytes }
}

export async function getFilePdfRendition(workspaceId: string, relativePath: string) {
  const workspace = get(workspaceId)
  if (!workspace) {
    return null
  }
  const config = getServerConfig()
  const cacheRoot = config.dataDir
    ? `${config.dataDir}/workspace/renditions`
    : `${config.dbPath}.workspace-renditions`
  return renderWorkspaceFilePdf({
    workspacePath: workspace.path,
    relativePath,
    cacheRoot,
  })
}

export async function setFileContent(input: {
  workspaceId: string
  relativePath: string
  content: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.relativePath)

  const { workspaceId, relativePath, content } = input
  const workspace = get(workspaceId)
  if (!workspace) {
    return {
      success: false,
      ownerBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath,
      }),
    }
  }
  return {
    success: await writeTextFile(workspace.path, relativePath, content),
    ownerBoundary: createWorkspaceFileWriteBoundary({
      workspacePath: workspace.path,
      relativePath,
    }),
  }
}

export async function createFile(input: {
  workspaceId: string
  relativePath: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.relativePath)
  const workspace = get(input.workspaceId)
  if (!workspace) {
    return createFileOperationResult(false, null, input.relativePath)
  }
  return createFileOperationResult(
    await createEmptyFile(workspace.path, input.relativePath),
    workspace.path,
    input.relativePath,
  )
}

export async function createFolder(input: {
  workspaceId: string
  relativePath: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.relativePath)
  const workspace = get(input.workspaceId)
  if (!workspace) {
    return createFileOperationResult(false, null, input.relativePath)
  }
  return createFileOperationResult(
    await createDirectory(workspace.path, input.relativePath),
    workspace.path,
    input.relativePath,
  )
}

export async function renameFilePath(input: {
  workspaceId: string
  sourcePath: string
  destinationPath: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.sourcePath)
  const workspace = get(input.workspaceId)
  if (!workspace) {
    return {
      success: false,
      sourceBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath: input.sourcePath,
      }),
      destinationBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath: input.destinationPath,
      }),
    }
  }
  return {
    success: await renameWorkspacePath(workspace.path, input.sourcePath, input.destinationPath),
    sourceBoundary: createWorkspaceFileWriteBoundary({
      workspacePath: workspace.path,
      relativePath: input.sourcePath,
    }),
    destinationBoundary: createWorkspaceFileWriteBoundary({
      workspacePath: workspace.path,
      relativePath: input.destinationPath,
    }),
  }
}

function assertConfirmedWorkspaceWrite(confirmed: boolean, relativePath: string): void {
  if (confirmed) {
    return
  }
  throw new AppError({
    code: 'non_cradle_owned_write_confirmation_required',
    status: 400,
    message: 'Workspace file writes require explicit non-Cradle-owned write confirmation',
    details: {
      ownerBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath,
      }),
    },
  })
}

function createFileOperationResult(success: boolean, workspacePath: string | null, relativePath: string) {
  return {
    success,
    ownerBoundary: createWorkspaceFileWriteBoundary({
      workspacePath,
      relativePath,
    }),
  }
}

function resolveAdHocWorkspaceRoot(): string {
  const configuredRoot = process.env[AD_HOC_WORKSPACE_ROOT_ENV]?.trim()
  if (configuredRoot) {
    return configuredRoot
  }
  return join(homedir(), 'Documents', 'Cradle')
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTimeId(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}
