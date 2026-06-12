import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'

import type { Workspace } from '@cradle/db'
import { workspaces } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db, getServerConfig } from '../../infra'
import { assertAppFeatureFlagEnabled } from '../preferences/service'
import { subscribeWorkspaceFileChanges } from './file-watch'
import {
  createDirectory,
  createEmptyFile,
  createWorkspaceFileWriteBoundary,
  getWorkspaceFileInfo,
  listFileChildren,
  listFiles,
  readTextFile,
  readWorkspaceFileBytes,
  renameWorkspacePath,
  renderWorkspaceFilePdf,
  searchWorkspaceFiles,
  writeTextFile,
} from './files'

// ── helpers ──

const NON_ALPHA_RE = /[^A-Z]/g
const AD_HOC_WORKSPACE_ROOT_ENV = 'CRADLE_AD_HOC_WORKSPACE_ROOT'
const MULTI_WORKSPACE_ROOT_ENV = 'CRADLE_MULTI_WORKSPACE_ROOT'
const MULTI_WORKSPACE_CONFIG_FILE = 'cradle-workspace.json'
const WORKSPACE_ENTRY_NAME_RE = /^[A-Za-z0-9._-]+$/

export interface MultiFolderWorkspaceFolder {
  name: string
  path: string
}

export interface MultiFolderWorkspaceConfig {
  name: string
  folders: MultiFolderWorkspaceFolder[]
}

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
  const configPath = join(path, MULTI_WORKSPACE_CONFIG_FILE)
  if (existsSync(configPath)) {
    assertMultiWorkspacePocEnabled()
    return createMultiFolderWorkspaceFromConfigPath(configPath)
  }
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

export function createMultiFolderWorkspace(input: MultiFolderWorkspaceConfig): Workspace {
  assertMultiWorkspacePocEnabled()
  const config = normalizeMultiFolderWorkspaceConfig(input)
  const workspaceRoot = resolveMultiWorkspacePath(config.name)

  if (existsSync(workspaceRoot)) {
    throw new AppError({
      code: 'multi_workspace_path_exists',
      status: 409,
      message: 'Multi-folder workspace path already exists',
      details: { path: workspaceRoot },
    })
  }

  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, MULTI_WORKSPACE_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  for (const folder of config.folders) {
    const linkPath = join(workspaceRoot, folder.name)
    symlinkSync(folder.path, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }

  return create({ name: config.name, path: workspaceRoot })
}

export function createMultiFolderWorkspaceFromConfigPath(path: string): Workspace {
  assertMultiWorkspacePocEnabled()
  if (!existsSync(path)) {
    throw new AppError({
      code: 'multi_workspace_config_not_found',
      status: 404,
      message: 'Multi-folder workspace config was not found',
      details: { path },
    })
  }

  return createMultiFolderWorkspace(readMultiFolderWorkspaceConfig(path))
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

export async function getFileChildren(workspaceId: string, relativePath = '') {
  const workspace = get(workspaceId)
  if (!workspace) {
    return []
  }
  return listFileChildren(workspace.path, relativePath)
}

export async function searchFiles(workspaceId: string, input: { query?: string, limit?: number }) {
  const workspace = get(workspaceId)
  if (!workspace) {
    return []
  }
  return searchWorkspaceFiles({
    workspacePath: workspace.path,
    query: input.query,
    limit: input.limit,
  })
}

export function openFileEvents(workspaceId: string): ReadableStream<Uint8Array> {
  const workspace = get(workspaceId)
  if (!workspace) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  }

  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let keepAlive: NodeJS.Timeout | null = null
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      send({
        type: 'ready',
        workspaceId,
        timestamp: Date.now(),
      })
      unsubscribe = subscribeWorkspaceFileChanges({
        workspaceId,
        workspacePath: workspace.path,
        listener: send,
      })
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
        catch {
          unsubscribe()
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
        }
      }, 15000)
    },
    cancel() {
      unsubscribe()
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
    },
  })
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

function assertMultiWorkspacePocEnabled(): void {
  assertAppFeatureFlagEnabled('multiWorkspacePoc', {
    code: 'multi_workspace_poc_disabled',
    status: 403,
    message: 'Multi-folder workspace POC is disabled. Enable it in Cradle settings first.',
  })
}

function readMultiFolderWorkspaceConfig(path: string): MultiFolderWorkspaceConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MultiFolderWorkspaceConfig
  }
  catch (error) {
    throw new AppError({
      code: 'multi_workspace_config_invalid',
      status: 400,
      message: 'Multi-folder workspace config could not be parsed',
      details: { path, reason: error instanceof Error ? error.message : String(error) },
    })
  }
}

function normalizeMultiFolderWorkspaceConfig(input: MultiFolderWorkspaceConfig): MultiFolderWorkspaceConfig {
  const name = input.name.trim()
  if (!isSafeWorkspaceEntryName(name)) {
    throw new AppError({
      code: 'multi_workspace_name_invalid',
      status: 400,
      message: 'Multi-folder workspace name may only contain letters, numbers, dots, underscores, and dashes',
      details: { name },
    })
  }

  if (!Array.isArray(input.folders) || input.folders.length === 0) {
    throw new AppError({
      code: 'multi_workspace_folders_required',
      status: 400,
      message: 'At least one folder is required for a multi-folder workspace',
    })
  }

  const names = new Set<string>()
  const folders = input.folders.map((folder) => {
    const folderName = folder.name.trim()
    const folderPath = resolve(folder.path.trim())
    if (!isSafeWorkspaceEntryName(folderName)) {
      throw new AppError({
        code: 'multi_workspace_folder_name_invalid',
        status: 400,
        message: 'Multi-folder workspace folder names may only contain letters, numbers, dots, underscores, and dashes',
        details: { name: folderName },
      })
    }
    if (names.has(folderName)) {
      throw new AppError({
        code: 'multi_workspace_folder_name_collision',
        status: 409,
        message: 'Multi-folder workspace folder names must be unique',
        details: { name: folderName },
      })
    }
    if (!isAbsolute(folder.path.trim())) {
      throw new AppError({
        code: 'multi_workspace_folder_path_relative',
        status: 400,
        message: 'Multi-folder workspace folder paths must be absolute',
        details: { name: folderName, path: folder.path },
      })
    }
    assertDirectory(folderPath, folderName)
    names.add(folderName)
    return { name: folderName, path: folderPath }
  })

  return { name, folders }
}

function isSafeWorkspaceEntryName(name: string): boolean {
  return name.length > 0
    && name !== '.'
    && name !== '..'
    && !name.includes(sep)
    && !name.includes('/')
    && !name.includes('\\')
    && WORKSPACE_ENTRY_NAME_RE.test(name)
}

function assertDirectory(path: string, name: string): void {
  try {
    if (lstatSync(path).isDirectory()) {
      return
    }
  }
  catch {
    throw new AppError({
      code: 'multi_workspace_folder_not_found',
      status: 400,
      message: 'Multi-folder workspace folder path must point to an existing directory',
      details: { name, path },
    })
  }

  throw new AppError({
    code: 'multi_workspace_folder_not_directory',
    status: 400,
    message: 'Multi-folder workspace folder path must point to a directory',
    details: { name, path },
  })
}

function resolveMultiWorkspacePath(name: string): string {
  return join(resolveMultiWorkspaceRoot(), name)
}

function resolveMultiWorkspaceRoot(): string {
  const configuredRoot = process.env[MULTI_WORKSPACE_ROOT_ENV]?.trim()
  if (configuredRoot) {
    return configuredRoot
  }
  return join(homedir(), 'Documents', 'Cradle', 'workspaces')
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
