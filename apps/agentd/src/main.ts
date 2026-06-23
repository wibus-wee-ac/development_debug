#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'

import { startAgentdRelayClient } from './relay-client'
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

if (process.argv[2] === 'relay') {
  const relayUrl = readArg('--relay-url') ?? process.env.CRADLE_AGENTD_RELAY_URL?.trim()
  const pairingToken = readArg('--pairing-token') ?? process.env.CRADLE_AGENTD_PAIRING_TOKEN?.trim()
  const hostToken = readArg('--host-token') ?? process.env.CRADLE_AGENTD_HOST_TOKEN?.trim()
  const roomId = readArg('--room-id') ?? process.env.CRADLE_AGENTD_ROOM_ID?.trim()

  if (!relayUrl || !pairingToken) {
    console.error('[agentd] relay mode requires --relay-url and --pairing-token')
    process.exitCode = 1
  }
  else {
    startAgentdRelayClient({
      homeDir,
      relayUrl,
      pairingToken,
      hostToken,
      roomId,
    })
      .then(async (client) => {
        console.log(`[agentd] relay pairing code ${client.pairingCode} expires at ${client.expiresAt}`)
        console.log(`[agentd] relay host connected for room ${client.roomId}`)
        await client.closed
      })
      .catch((error) => {
        console.error('[agentd] relay failed', error)
        process.exitCode = 1
      })
  }
}
else {
  const socketPath = resolveSocketPath(homeDir)

  startAgentdServer({ homeDir, socketPath })
    .then(() => {
      console.log(`[agentd] listening on ${socketPath}`)
    })
    .catch((error) => {
      console.error('[agentd] failed to start', error)
      process.exitCode = 1
    })
}
