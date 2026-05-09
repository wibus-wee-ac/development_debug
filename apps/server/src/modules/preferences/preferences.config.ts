// Input: ServerConfig data directory
// Output: preferences storage root and chat preference path
// Position: apps/server/src/modules/preferences configuration

import { dirname, join } from 'node:path'

import { injectable } from 'tsyringe'

import { ServerConfig } from '../../config/server-config'

@injectable()
export class PreferencesConfig {
  constructor(private readonly serverConfig: ServerConfig) {}

  getRootDir(): string {
    const config = this.serverConfig.get()
    const baseDir = config.dataDir ?? dirname(config.dbPath)
    return join(baseDir, 'preferences')
  }

  getChatPreferencesPath(): string {
    return join(this.getRootDir(), 'chat.json')
  }
}