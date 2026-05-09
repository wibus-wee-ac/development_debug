// Input: ServerConfig
// Output: dbPath and dataDir for SQLite
// Position: server database config

import { injectable } from 'tsyringe'

import { ServerConfig } from '../config/server-config'

export interface DatabaseOptions {
  dbPath: string
  dataDir?: string
}

@injectable()
export class DatabaseConfig {
  constructor(private readonly config: ServerConfig) {}

  getOptions(): DatabaseOptions {
    const cfg = this.config.get()
    return { dbPath: cfg.dbPath, dataDir: cfg.dataDir }
  }
}
