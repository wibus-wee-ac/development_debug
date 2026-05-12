// Input: Electron dialog/shell plus feature-owned workspace application service
// Output: WorkspaceService IPC adapter for workspace lifecycle and file-access commands
// Position: App-level IPC surface delegating workspace behavior to the workspace feature

import { IpcMethod, IpcService } from '@cradle/ipc'
import { dialog, shell } from 'electron'

import { getDb } from '../../db'
import type { Workspace } from '../../db/schema'
import type { WorkspaceApplicationService } from '../../workspace/workspace'
import { createDbWorkspaceStore, createWorkspaceApplicationService } from '../../workspace/workspace'

function createDefaultWorkspaceApplication(): WorkspaceApplicationService {
  return createWorkspaceApplicationService({
    store: createDbWorkspaceStore(getDb()),
  })
}

export class WorkspaceService extends IpcService {
  static readonly groupName = 'workspace'

  private readonly appService: WorkspaceApplicationService

  constructor(appService: WorkspaceApplicationService = createDefaultWorkspaceApplication()) {
    super()
    this.appService = appService
  }

  @IpcMethod()
  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  }

  @IpcMethod()
  async addFromDirectory(dirPath: string): Promise<Workspace> {
    return this.appService.addFromDirectory(dirPath)
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
    return this.appService.list()
  }

  @IpcMethod()
  get(id: string): Workspace | undefined {
    return this.appService.get(id)
  }

  @IpcMethod()
  resolveByPath(path: string): Workspace | undefined {
    return this.appService.resolveByPath(path)
  }

  @IpcMethod()
  create(input: { name: string, path: string }): Workspace {
    return this.appService.create(input)
  }

  @IpcMethod()
  update(input: { id: string, name: string }): Workspace | undefined {
    return this.appService.update(input)
  }

  @IpcMethod()
  delete(id: string): void {
    this.appService.delete(id)
  }

  /**
   * Recursively list files in a workspace for @ mention suggestions.
   * Respects .gitignore and skips hidden files / node_modules.
   * Returns relative paths from workspace root.
   */
  @IpcMethod()
  async listFiles(workspaceId: string): Promise<Array<{ type: 'file' | 'directory', name: string, path: string }>> {
    return this.appService.listFiles(workspaceId)
  }

  @IpcMethod()
  async readTextFile(workspaceId: string, relativePath: string): Promise<string | null> {
    return this.appService.readTextFile(workspaceId, relativePath)
  }

  @IpcMethod()
  async writeTextFile(workspaceId: string, relativePath: string, content: string): Promise<boolean> {
    return this.appService.writeTextFile(workspaceId, relativePath, content)
  }
}
