// Input: DataTransfer instances from workspace file tree drag/drop interactions
// Output: Helpers for serializing and reading Cradle workspace file drag payloads
// Position: Shared renderer drag/drop protocol between workspace file tree, chat, and TUI

import { join, normalize } from 'pathe'

const WORKSPACE_FILE_DRAG_MIME = 'application/x-cradle-workspace-file+json'

export interface WorkspaceFileDragPayload {
  absolutePath?: string
  relativePath: string
}

interface WorkspaceFileDragInput {
  relativePath: string
  workspacePath?: string | null
}

export function quoteWorkspacePath(path: string): string {
  const normalized = normalize(path)
  return normalized.includes(' ') ? `"${normalized}"` : normalized
}

export function serializeWorkspaceFileDragPayload({ relativePath, workspacePath }: WorkspaceFileDragInput): WorkspaceFileDragPayload {
  return {
    relativePath: normalize(relativePath),
    absolutePath: workspacePath ? normalize(join(workspacePath, relativePath)) : undefined,
  }
}

export function writeWorkspaceFileDragData(dataTransfer: DataTransfer, payload: WorkspaceFileDragPayload): void {
  dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', quoteWorkspacePath(payload.absolutePath ?? payload.relativePath))
}

export function readWorkspaceFileDragText(dataTransfer: DataTransfer): string | null {
  const rawPayload = dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME)
  if (rawPayload) {
    try {
      const payload = JSON.parse(rawPayload) as Partial<WorkspaceFileDragPayload>
      const path = typeof payload.absolutePath === 'string' && payload.absolutePath.length > 0
        ? payload.absolutePath
        : typeof payload.relativePath === 'string' && payload.relativePath.length > 0
          ? payload.relativePath
          : null
      return path ? quoteWorkspacePath(path) : null
    }
    catch {
      return null
    }
  }

  return dataTransfer.getData('text/plain') || null
}
