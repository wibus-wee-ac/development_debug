import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { desc, eq } from 'drizzle-orm'

import { getDb } from '../db'
import type { Workspace } from '../db/schema'
import { workspaces } from '../db/schema'

export class WorkspaceService extends IpcService {
  static readonly groupName = 'workspace'

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
