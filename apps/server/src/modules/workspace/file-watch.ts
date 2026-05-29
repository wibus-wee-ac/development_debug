// Output: Workspace-owned file change watch streams for Explorer-style refreshes.
// Input: Workspace ids and workspace root paths.
// Position: Internal watcher broker used by workspace routes and services.

import type { FSWatcher } from 'node:fs'
import { watch } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import { invalidateWorkspaceFileList } from './files'

export interface WorkspaceFileChangeEvent {
  type: 'directory-changed'
  workspaceId: string
  path: string
  timestamp: number
}

type WorkspaceFileChangeListener = (event: WorkspaceFileChangeEvent) => void

interface WorkspaceWatchRecord {
  listeners: Set<WorkspaceFileChangeListener>
  refCount: number
  watcher: FSWatcher
  workspaceId: string
  workspacePath: string
}

const watchRecords = new Map<string, WorkspaceWatchRecord>()
const pendingEventsByKey = new Map<string, WorkspaceFileChangeEvent>()
let flushTimer: NodeJS.Timeout | null = null

export function subscribeWorkspaceFileChanges(input: {
  workspaceId: string
  workspacePath: string
  listener: WorkspaceFileChangeListener
}): () => void {
  const workspacePath = resolve(input.workspacePath)
  const record = getOrCreateWatchRecord(input.workspaceId, workspacePath)
  record.refCount += 1
  record.listeners.add(input.listener)

  return () => {
    record.listeners.delete(input.listener)
    record.refCount -= 1
    if (record.refCount > 0) {
      return
    }
    record.watcher.close()
    watchRecords.delete(input.workspaceId)
  }
}

function getOrCreateWatchRecord(workspaceId: string, workspacePath: string): WorkspaceWatchRecord {
  const existing = watchRecords.get(workspaceId)
  if (existing && existing.workspacePath === workspacePath) {
    return existing
  }
  existing?.watcher.close()

  const record: WorkspaceWatchRecord = {
    listeners: new Set(),
    refCount: 0,
    watcher: watch(workspacePath, { recursive: true }, (_eventType, filename) => {
      invalidateWorkspaceFileList(workspacePath)
      queueDirectoryChanged(record, readChangedDirectoryPath(workspacePath, filename))
    }),
    workspaceId,
    workspacePath,
  }
  record.watcher.on('error', () => {
    queueDirectoryChanged(record, '')
  })
  watchRecords.set(workspaceId, record)
  return record
}

function readChangedDirectoryPath(workspacePath: string, filename: string | Buffer | null): string {
  if (!filename) {
    return ''
  }
  const normalizedRelativePath = normalizeRelativePath(filename.toString())
  if (normalizedRelativePath.length === 0) {
    return ''
  }
  const absolutePath = resolve(workspacePath, normalizedRelativePath)
  const parent = dirname(absolutePath)
  if (parent === workspacePath) {
    return ''
  }
  return normalizeRelativePath(relative(workspacePath, parent))
}

function queueDirectoryChanged(record: WorkspaceWatchRecord, path: string): void {
  const event = {
    type: 'directory-changed',
    workspaceId: record.workspaceId,
    path,
    timestamp: Date.now(),
  } satisfies WorkspaceFileChangeEvent
  pendingEventsByKey.set(`${record.workspaceId}\0${path}`, event)
  if (flushTimer) {
    return
  }
  flushTimer = setTimeout(flushWorkspaceFileChangeEvents, 100)
}

function flushWorkspaceFileChangeEvents(): void {
  flushTimer = null
  const events = [...pendingEventsByKey.values()]
  pendingEventsByKey.clear()
  for (const event of events) {
    const record = watchRecords.get(event.workspaceId)
    if (!record) {
      continue
    }
    for (const listener of record.listeners) {
      listener(event)
    }
  }
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/').replace(/^\/+|\/+$/g, '')
}
