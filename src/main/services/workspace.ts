import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { dialog, shell } from 'electron'
import { desc, eq } from 'drizzle-orm'

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
    if (result.canceled || result.filePaths.length === 0) return null
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
}
