import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { desc, eq } from 'drizzle-orm'
import { dialog, shell } from 'electron'
import fg from 'fast-glob'
import ignore from 'ignore'

import { getDb } from '../db'
import type { Workspace } from '../db/schema'
import { workspaces } from '../db/schema'

export class WorkspaceService extends IpcService {
  static readonly groupName = 'workspace'

  @IpcMethod()
  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
    })
    if (result.canceled || result.filePaths.length === 0) { return null }
    return result.filePaths[0]
  }

  @IpcMethod()
  async addFromDirectory(dirPath: string): Promise<Workspace> {
    const name = basename(dirPath)
    return this.create({ name, path: dirPath })
  }

  @IpcMethod()
  openInFinder(dirPath: string): void {
    shell.showItemInFolder(dirPath)
  }

  @IpcMethod()
  async openInDefaultApp(dirPath: string): Promise<void> {
    await shell.openPath(dirPath)
  }

  @IpcMethod()
  list(): Workspace[] {
    return getDb().select().from(workspaces).orderBy(desc(workspaces.createdAt)).all()
  }

  @IpcMethod()
  get(id: string): Workspace | undefined {
    return getDb().select().from(workspaces).where(eq(workspaces.id, id)).get()
  }

  @IpcMethod()
  create(input: { name: string, path: string }): Workspace {
    const db = getDb()
    const id = randomUUID()
    const result = db
      .insert(workspaces)
      .values({ id, name: input.name, path: input.path })
      .returning()
      .get()
    return result
  }

  @IpcMethod()
  update(input: { id: string, name: string }): Workspace | undefined {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const result = db
      .update(workspaces)
      .set({ name: input.name, updatedAt: now })
      .where(eq(workspaces.id, input.id))
      .returning()
      .get()
    return result
  }

  @IpcMethod()
  delete(id: string): void {
    getDb().delete(workspaces).where(eq(workspaces.id, id)).run()
  }

  /**
   * Recursively list files in a workspace for @ mention suggestions.
   * Respects .gitignore and skips hidden files / node_modules.
   * Returns relative paths from workspace root.
   */
  @IpcMethod()
  async listFiles(workspaceId: string): Promise<Array<{ type: 'file' | 'directory', name: string, path: string }>> {
    const ws = getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
    if (!ws) {
      return []
    }

    // Read .gitignore if present
    const ig = ignore()
    try {
      const gitignoreContent = await readFile(join(ws.path, '.gitignore'), 'utf8')
      ig.add(gitignoreContent)
    }
    catch {
      // No .gitignore, continue without it
    }
    // Always ignore these
    ig.add(['node_modules', '.git', '.DS_Store'])

    const entries = await fg('**/*', {
      cwd: ws.path,
      dot: false,
      onlyFiles: false,
      markDirectories: true,
    })

    const filtered = entries.filter(ig.createFilter())

    return filtered.map((entry) => {
      const isDir = entry.endsWith('/')
      const cleanPath = isDir ? entry.slice(0, -1) : entry
      return {
        type: isDir ? 'directory' as const : 'file' as const,
        name: basename(cleanPath),
        path: cleanPath,
      }
    })
  }
}
