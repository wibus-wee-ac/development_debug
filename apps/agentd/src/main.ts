#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'

import { startAgentdServer } from './server'

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return null
  }
  return process.argv[index + 1] ?? null
}

function resolveHomeDir(): string {
  return process.env.CRADLE_AGENTD_HOME?.trim() || join(homedir(), '.cradle', 'agentd')
}

function resolveSocketPath(homeDir: string): string {
  return readArg('--socket')
    ?? process.env.CRADLE_AGENTD_SOCKET?.trim()
    ?? join(homeDir, 'agent.sock')
}

const homeDir = resolveHomeDir()
const socketPath = resolveSocketPath(homeDir)

startAgentdServer({ homeDir, socketPath })
  .then(() => {
    console.log(`[agentd] listening on ${socketPath}`)
  })
  .catch((error) => {
    console.error('[agentd] failed to start', error)
    process.exitCode = 1
  })
