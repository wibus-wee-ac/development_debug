// Input: workspace DB store, node filesystem helpers, fast-glob, and ignore rules
// Output: Workspace application service plus DB-backed store for workspace CRUD and safe file access
// Position: Feature-owned coordination for workspace records, directory-backed file inventory, and guarded text IO

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

import { desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import fg from 'fast-glob'
import ignore from 'ignore'

import type * as schema from '../../db/schema'
import type { Workspace } from '../../db/schema'
import { workspaces } from '../../db/schema'

export interface WorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

export interface WorkspaceStore {
  list: () => Workspace[]
  get: (id: string) => Workspace | undefined
  resolveByPath: (path: string) => Workspace | undefined
  create: (input: { name: string, path: string }) => Workspace
  update: (input: { id: string, name: string }) => Workspace | undefined
  delete: (id: string) => void
}

export interface WorkspaceApplicationService {
  list: () => Workspace[]
  get: (id: string) => Workspace | undefined
  resolveByPath: (path: string) => Workspace | undefined
  addFromDirectory: (dirPath: string) => Workspace
  create: (input: { name: string, path: string }) => Workspace
  update: (input: { id: string, name: string }) => Workspace | undefined
  delete: (id: string) => void
  listFiles: (workspaceId: string) => Promise<WorkspaceFileEntry[]>
  readTextFile: (workspaceId: string, relativePath: string) => Promise<string | null>
  writeTextFile: (workspaceId: string, relativePath: string, content: string) => Promise<boolean>
}

export function createDbWorkspaceStore(
  db: BetterSQLite3Database<typeof schema>,
): WorkspaceStore {
  return {
    list() {
      return db.select().from(workspaces).orderBy(desc(workspaces.createdAt)).all()
    },
    get(id) {
      return db.select().from(workspaces).where(eq(workspaces.id, id)).get()
    },
    resolveByPath(path) {
      return db.select().from(workspaces).where(eq(workspaces.path, path)).get()
    },
    create(input) {
      const id = randomUUID()
      return db
        .insert(workspaces)
        .values({ id, name: input.name, path: input.path })
        .returning()
        .get()
    },
    update(input) {
      const now = Math.floor(Date.now() / 1000)
      return db
        .update(workspaces)
        .set({ name: input.name, updatedAt: now })
        .where(eq(workspaces.id, input.id))
        .returning()
        .get()
    },
    delete(id) {
      db.delete(workspaces).where(eq(workspaces.id, id)).run()
    },
  }
}

interface WorkspaceApplicationDeps {
  store: WorkspaceStore
}

export function createWorkspaceApplicationService(
  deps: WorkspaceApplicationDeps,
): WorkspaceApplicationService {
  const resolveWorkspace = (workspaceId: string): Workspace | undefined => deps.store.get(workspaceId)

  return {
    list: () => deps.store.list(),
    get: id => deps.store.get(id),
    resolveByPath: path => deps.store.resolveByPath(path),
    addFromDirectory: dirPath => deps.store.create({
      name: basename(dirPath),
      path: dirPath,
    }),
    create: input => deps.store.create(input),
    update: input => deps.store.update(input),
    delete: id => deps.store.delete(id),
    async listFiles(workspaceId) {
      const workspace = resolveWorkspace(workspaceId)
      if (!workspace) {
        return []
      }

      const ig = ignore()
      try {
        ig.add(await readFile(join(workspace.path, '.gitignore'), 'utf8'))
      }
      catch {
        // Missing .gitignore is fine.
      }
      ig.add(['node_modules', '.git', '.DS_Store'])

      const entries = await fg('**/*', {
        cwd: workspace.path,
        dot: false,
        onlyFiles: false,
        markDirectories: true,
      })

      return entries
        .filter(ig.createFilter())
        .map((entry) => {
          const isDirectory = entry.endsWith('/')
          const cleanPath = isDirectory ? entry.slice(0, -1) : entry
          return {
            type: isDirectory ? 'directory' as const : 'file' as const,
            name: basename(cleanPath),
            path: cleanPath,
          }
        })
    },
    async readTextFile(workspaceId, relativePath) {
      const workspace = resolveWorkspace(workspaceId)
      if (!workspace) {
        return null
      }
      const fullPath = resolveWorkspacePath(workspace.path, relativePath)
      if (!fullPath) {
        return null
      }
      try {
        return await readFile(fullPath, 'utf8')
      }
      catch {
        return null
      }
    },
    async writeTextFile(workspaceId, relativePath, content) {
      const workspace = resolveWorkspace(workspaceId)
      if (!workspace) {
        return false
      }
      const fullPath = resolveWorkspacePath(workspace.path, relativePath)
      if (!fullPath) {
        return false
      }
      try {
        await writeFile(fullPath, content, 'utf8')
        return true
      }
      catch {
        return false
      }
    },
  }
}

function resolveWorkspacePath(workspacePath: string, relativePath: string): string | null {
  const resolvedWorkspace = resolve(workspacePath)
  const fullPath = resolve(resolvedWorkspace, relativePath)
  return isWithinRoot(resolvedWorkspace, fullPath) ? fullPath : null
}

function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const normalizedRoot = resolve(rootDir)
  const normalizedTarget = resolve(targetPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}