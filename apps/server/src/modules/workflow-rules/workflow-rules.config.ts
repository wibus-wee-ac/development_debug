// Input: ServerConfig data directory
// Output: workflow-rules storage root
// Position: apps/server/src/modules/workflow-rules/workflow-rules.config.ts

import { dirname, join } from 'node:path'

import { injectable } from 'tsyringe'

import { ServerConfig } from '../../config/server-config'

@injectable()
export class WorkflowRulesConfig {
  constructor(private readonly serverConfig: ServerConfig) {}

  getRootDir(): string {
    const config = this.serverConfig.get()
    const baseDir = config.dataDir ?? dirname(config.dbPath)
    return join(baseDir, 'workflow-rules')
  }
}
