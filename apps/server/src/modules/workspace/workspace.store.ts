// Input: DbAccessor + workspace tables
// Output: workspace CRUD store
// Position: apps/server/src/modules/workspace/workspace.store.ts

import { randomUUID } from 'node:crypto'

import { workspaces } from '@cradle/db'
import type { Workspace } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'

@injectable()
export class WorkspaceStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  list(): Workspace[] {
    return this.dbAccessor.get().select().from(workspaces).orderBy(workspaces.name).all()
  }

  get(id: string): Workspace | undefined {
    return this.dbAccessor.get().select().from(workspaces).where(eq(workspaces.id, id)).get()
  }

  resolveByPath(path: string): Workspace | undefined {
    return this.dbAccessor.get().select().from(workspaces).where(eq(workspaces.path, path)).get()
  }

  create(input: { name: string; path: string }): Workspace {
    const id = randomUUID()
    return this.dbAccessor.get().insert(workspaces).values({ id, name: input.name, path: input.path }).returning().get()
  }

  update(input: { id: string; name: string }): Workspace | undefined {
    return this.dbAccessor.get().update(workspaces).set({ name: input.name }).where(eq(workspaces.id, input.id)).returning().get()
  }

  delete(id: string): void {
    this.dbAccessor.get().delete(workspaces).where(eq(workspaces.id, id)).run()
  }
}
