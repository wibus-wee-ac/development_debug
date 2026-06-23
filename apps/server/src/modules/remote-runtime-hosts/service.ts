import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { RemoteRuntimeHost } from '@cradle/db'
import { remoteRuntimeHosts } from '@cradle/db'
import type {
  AgentListResult,
  AgentStartParams,
  AgentStartResult,
  HostHealthResult,
  RemoteAgentParams,
  RemoteAgentResult,
  RemoteAgentStreamMethod,
  RemoteAgentStreamValue,
  RemoteAgentUnaryMethod,
  RuntimeListResult,
  WorkspaceListParams,
  WorkspaceListResult,
} from '@cradle/remote-agent-protocol'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { createRelayRoomId, mintRelayToken } from '../relay-servers/relay-token-service'
import { readDefaultRelayServer, resolveRelayUrl } from '../relay-servers/service'
import {
  createRemoteAgentDaemonClient,
  RemoteAgentRpcError,
  RemoteAgentTransportError,
  type RemoteAgentDaemonClient,
  type RemoteRuntimeHostConnectionState,
} from './daemon-client'
import {
  createRelayRemoteAgentDaemonClient,
} from './relay-transport'
import {
  deleteRemoteRuntimeSessionLink,
  readRemoteRuntimeSessionLink,
  upsertRemoteRuntimeSessionLink,
  type UpsertRemoteRuntimeSessionLinkInput,
} from './session-links'
import { startSshTunnel, type SshTunnelHandle } from './ssh-tunnel'

export {
  deleteRemoteRuntimeSessionLink,
  readRemoteRuntimeSessionLink,
  upsertRemoteRuntimeSessionLink,
  type UpsertRemoteRuntimeSessionLinkInput,
}

export interface CreateRemoteRuntimeHostInput {
  id?: string
  displayName: string
  sshTarget?: string
  remoteSocketPath?: string
  enabled?: boolean
  transport?: RemoteRuntimeHostTransport
  sshProfile?: RemoteRuntimeHostSshProfileInput | null
  localSocketPath?: string
  connectTimeoutMs?: number
  connectionConfig?: Record<string, unknown>
}

export interface UpdateRemoteRuntimeHostInput {
  displayName?: string
  sshTarget?: string
  remoteSocketPath?: string
  enabled?: boolean
  transport?: RemoteRuntimeHostTransport
  sshProfile?: RemoteRuntimeHostSshProfileInput | null
  localSocketPath?: string
  connectTimeoutMs?: number
  connectionConfig?: Record<string, unknown>
}

export type RemoteRuntimeHostTransport = 'ssh' | 'direct-socket' | 'relay'

export interface RemoteRuntimeHostSshProfileInput {
  hostName: string
  user?: string | null
  port?: number | null
  auth?: 'default' | 'identityFile'
  identityFilePath?: string | null
}

export interface RemoteRuntimeHostSshProfile {
  hostName: string
  user: string | null
  port: number | null
  auth: 'default' | 'identityFile'
  identityFilePath: string | null
}

export interface SshProfileLaunchConfig {
  sshTarget: string
  sshArgs: string[]
}

export interface RemoteRuntimeHostView extends RemoteRuntimeHost {
  connectionState: RemoteRuntimeHostConnectionState
  lastError: string | null
}

export interface RemoteRuntimeHostConnectionView {
  hostId: string
  state: RemoteRuntimeHostConnectionState
  localSocketPath: string | null
  daemonHostId: string | null
  daemonVersion: string | null
  platform: string | null
  arch: string | null
  lastError: string | null
}

export interface RemoteRuntimeHostHealthView {
  hostId: string
  status: 'ok' | 'offline'
  daemonVersion: string | null
  daemonHostId: string | null
  uptimeSeconds: number | null
  connectionState: RemoteRuntimeHostConnectionState
  lastError: string | null
}

interface RemoteRuntimeHostConnectionRecord {
  host: RemoteRuntimeHost
  client: RemoteAgentDaemonClient | null
  tunnel: SshTunnelHandle | null
  localSocketPath: string | null
  lastError: string | null
  tunnelExited: boolean
}

interface ConnectionConfigTransportFields {
  transport?: RemoteRuntimeHostTransport
  localSocketPath?: string
  ssh?: RemoteRuntimeHostSshProfile
  relay?: RemoteRuntimeHostRelayConfig
}

export interface RemoteRuntimeHostRelayConfig {
  relayUrl: string
  roomId: string
  controllerToken: string
}

interface NormalizedRemoteRuntimeHostConnection {
  sshTarget: string
  remoteSocketPath: string
  connectionConfigJson: string
}

interface RemoteRuntimeHostConnectionPatch {
  sshTarget?: string
  remoteSocketPath?: string
  transport?: RemoteRuntimeHostTransport
  sshProfile?: RemoteRuntimeHostSshProfileInput | null
  localSocketPath?: string
  connectTimeoutMs?: number
  connectionConfig?: Record<string, unknown>
}

const nonBlankStringSchema = z.string().trim().min(1)
const transportSchema = z.enum(['ssh', 'direct-socket', 'relay'])
const sshAuthSchema = z.enum(['default', 'identityFile'])
const sshProfileSchema = z.object({
  hostName: nonBlankStringSchema,
  user: nonBlankStringSchema.nullable().optional(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  auth: sshAuthSchema.default('default'),
  identityFilePath: nonBlankStringSchema.nullable().optional(),
}).superRefine((profile, ctx) => {
  if (profile.auth === 'identityFile' && !profile.identityFilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identityFilePath'],
      message: 'identityFilePath is required when SSH auth is identityFile.',
    })
  }
  if (profile.auth === 'default' && profile.identityFilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identityFilePath'],
      message: 'identityFilePath can only be set when SSH auth is identityFile.',
    })
  }
}).transform(profile => ({
  hostName: profile.hostName,
  user: profile.user ?? null,
  port: profile.port ?? null,
  auth: profile.auth,
  identityFilePath: profile.auth === 'identityFile' ? profile.identityFilePath ?? null : null,
}))

const connectionConfigSchema = z.object({
  transport: transportSchema.optional(),
  localSocketPath: nonBlankStringSchema.optional(),
  ssh: sshProfileSchema.optional(),
  relay: z.object({
    relayUrl: nonBlankStringSchema,
    roomId: nonBlankStringSchema,
    controllerToken: nonBlankStringSchema,
  }).optional(),
  sshExecutable: nonBlankStringSchema.optional(),
  sshArgs: z.array(z.string()).optional(),
  connectTimeoutMs: z.number().int().positive().max(120_000).optional(),
}).passthrough().superRefine((config, ctx) => {
  if (inferConnectionTransport(config) === 'direct-socket' && !config.localSocketPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['localSocketPath'],
      message: 'localSocketPath is required when transport is direct-socket.',
    })
  }
  // A relay host is created "pending" — transport is relay but the relay
  // coordinates (relayUrl/roomId/controllerToken) are only filled in once the
  // user completes pairing from the UI. Until then there is no relay block,
  // and that is valid; connecting simply fails until pairing is done.
}).transform(config => ({
  ...config,
  transport: inferConnectionTransport(config),
}))

type RemoteRuntimeHostConnectionConfig = z.infer<typeof connectionConfigSchema>

const DEFAULT_REMOTE_DAEMON_SOCKET_PATH = '~/.cradle/agentd/agent.sock'
const UNIX_SOCKET_PATH_LIMIT = 100

const connections = new Map<string, RemoteRuntimeHostConnectionRecord>()
const connectPromises = new Map<string, Promise<RemoteRuntimeHostConnectionView>>()

export function listRemoteRuntimeHosts(): RemoteRuntimeHostView[] {
  return db()
    .select()
    .from(remoteRuntimeHosts)
    .orderBy(asc(remoteRuntimeHosts.displayName), asc(remoteRuntimeHosts.id))
    .all()
    .map(toHostView)
}

export function readRemoteRuntimeHost(hostId: string): RemoteRuntimeHostView {
  return toHostView(requireRemoteRuntimeHost(hostId))
}

export function createRemoteRuntimeHost(input: CreateRemoteRuntimeHostInput): RemoteRuntimeHostView {
  const now = currentUnixSeconds()
  const normalized = normalizeRemoteRuntimeHostConnection(input, null)
  const row = db()
    .insert(remoteRuntimeHosts)
    .values({
      id: input.id ?? randomUUID(),
      displayName: input.displayName.trim(),
      sshTarget: normalized.sshTarget,
      remoteSocketPath: normalized.remoteSocketPath,
      enabled: input.enabled ?? true,
      connectionConfigJson: normalized.connectionConfigJson,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  return toHostView(row)
}

export function updateRemoteRuntimeHost(hostId: string, patch: UpdateRemoteRuntimeHostInput): RemoteRuntimeHostView {
  const current = requireRemoteRuntimeHost(hostId)
  const update: Partial<typeof remoteRuntimeHosts.$inferInsert> = {
    updatedAt: currentUnixSeconds(),
  }
  if (patch.displayName !== undefined) {
    update.displayName = patch.displayName.trim()
  }
  if (patch.sshTarget !== undefined) {
    update.sshTarget = patch.sshTarget.trim()
  }
  if (patch.remoteSocketPath !== undefined) {
    update.remoteSocketPath = patch.remoteSocketPath.trim()
  }
  if (patch.enabled !== undefined) {
    update.enabled = patch.enabled
  }
  if (hasConnectionPatch(patch)) {
    const normalized = normalizeRemoteRuntimeHostConnection(patch, current)
    update.sshTarget = normalized.sshTarget
    update.remoteSocketPath = normalized.remoteSocketPath
    update.connectionConfigJson = normalized.connectionConfigJson
  }

  const row = db()
    .update(remoteRuntimeHosts)
    .set(update)
    .where(eq(remoteRuntimeHosts.id, hostId))
    .returning()
    .get()
  return toHostView(row)
}

export async function deleteRemoteRuntimeHost(hostId: string): Promise<void> {
  await disconnectRemoteRuntimeHost(hostId)
  db()
    .delete(remoteRuntimeHosts)
    .where(eq(remoteRuntimeHosts.id, hostId))
    .run()
}

export async function connectRemoteRuntimeHost(hostId: string): Promise<RemoteRuntimeHostConnectionView> {
  const existingPromise = connectPromises.get(hostId)
  if (existingPromise) {
    return existingPromise
  }

  const promise = connectRemoteRuntimeHostInner(hostId).finally(() => {
    connectPromises.delete(hostId)
  })
  connectPromises.set(hostId, promise)
  return promise
}

export async function disconnectRemoteRuntimeHost(hostId: string): Promise<void> {
  const record = connections.get(hostId)
  connections.delete(hostId)
  if (!record) {
    return
  }
  await record.client?.close()
  await record.tunnel?.close()
}

export async function readRemoteRuntimeHostHealth(hostId: string): Promise<RemoteRuntimeHostHealthView> {
  const record = requireConnectedRecord(hostId)
  try {
    const health = await record.client.call('host/health', {})
    return {
      hostId,
      status: 'ok',
      daemonVersion: health.daemonVersion,
      daemonHostId: health.hostId,
      uptimeSeconds: health.uptimeSeconds,
      connectionState: connectionStateOf(record),
      lastError: record.lastError,
    }
  }
  catch (error) {
    throw toAppError(error, 'remote_host_health_failed')
  }
}

export async function listRemoteRuntimes(hostId: string): Promise<RuntimeListResult> {
  return await callRemoteRuntimeHost(hostId, 'runtime/list', {})
}

export async function listRemoteWorkspaces(
  hostId: string,
  params: WorkspaceListParams,
): Promise<WorkspaceListResult> {
  return await callRemoteRuntimeHost(hostId, 'workspace/list', params)
}

export async function listRemoteAgents(hostId: string): Promise<AgentListResult> {
  return await callRemoteRuntimeHost(hostId, 'agent/list', {})
}

export async function startRemoteAgent(
  hostId: string,
  params: AgentStartParams,
): Promise<AgentStartResult> {
  return await callRemoteRuntimeHost(hostId, 'agent/start', params)
}

export interface CreateRemoteRuntimeHostRelayPairingTokenInput {
  relayUrl?: string
  relayServerId?: string
  ttlMs?: number
}

export interface RemoteRuntimeHostRelayPairingTokenView {
  relayUrl: string
  relayServerId: string | null
  roomId: string
  pairingToken: string
  hostToken: string
  expiresAt: string
}

export interface ClaimRemoteRuntimeHostRelayPairingInput {
  relayUrl?: string
  relayServerId?: string
  pairingCode: string
  ttlMs?: number
}

export interface RemoteRuntimeHostRelayClaimView {
  relayUrl: string
  roomId: string
  controllerToken: string
  expiresAt: string
}

/**
 * Resolve which relay server a pairing operation should target.
 *
 * Precedence: an explicit relayUrl wins (legacy/ad-hoc), then a configured
 * relay server by id, then the host's stored relay config, then the default
 * relay server. Returns the resolved URL and, when known, the relay server id
 * so the pairing-token response can echo it back to the UI.
 */
function resolvePairingRelay(input: {
  relayUrl?: string
  relayServerId?: string
  storedRelayUrl?: string
}): { relayUrl: string, relayServerId: string | null } {
  if (input.relayUrl?.trim()) {
    return { relayUrl: input.relayUrl.trim(), relayServerId: null }
  }
  if (input.relayServerId?.trim()) {
    return { relayUrl: resolveRelayUrl(input.relayServerId.trim()), relayServerId: input.relayServerId.trim() }
  }
  if (input.storedRelayUrl?.trim()) {
    return { relayUrl: input.storedRelayUrl.trim(), relayServerId: null }
  }
  const defaultServer = readDefaultRelayServer()
  if (defaultServer) {
    return { relayUrl: defaultServer.relayUrl, relayServerId: defaultServer.id }
  }
  throw new AppError({
    code: 'remote_relay_url_required',
    status: 400,
    message: 'A relay server is required to pair a remote host. Configure one under Relay servers or pass a relay URL.',
  })
}

export function createRemoteRuntimeHostRelayPairingToken(
  hostId: string,
  input: CreateRemoteRuntimeHostRelayPairingTokenInput,
): RemoteRuntimeHostRelayPairingTokenView {
  requireRemoteRuntimeHost(hostId)
  const host = readRemoteRuntimeHost(hostId)
  const currentConfig = parseConnectionConfig(host.connectionConfigJson)
  const { relayUrl, relayServerId } = resolvePairingRelay({
    relayUrl: input.relayUrl,
    relayServerId: input.relayServerId,
    storedRelayUrl: currentConfig.relay?.relayUrl,
  })
  const roomId = createRelayRoomId()
  const pairingToken = mintRelayToken({
    subject: `remote-host:${hostId}`,
    purpose: 'pairing_start',
    roomId,
    ttlMs: input.ttlMs,
  })
  const hostToken = mintRelayToken({
    subject: `remote-host:${hostId}:host`,
    purpose: 'ws',
    role: 'host',
    roomId,
    ttlMs: input.ttlMs,
  })
  return {
    relayUrl,
    relayServerId,
    roomId,
    pairingToken: pairingToken.token,
    hostToken: hostToken.token,
    expiresAt: pairingToken.expiresAt,
  }
}

export async function claimRemoteRuntimeHostRelayPairing(
  hostId: string,
  input: ClaimRemoteRuntimeHostRelayPairingInput,
): Promise<RemoteRuntimeHostRelayClaimView> {
  const host = requireRemoteRuntimeHost(hostId)
  const currentConfig = parseConnectionConfig(host.connectionConfigJson)
  const { relayUrl } = resolvePairingRelay({
    relayUrl: input.relayUrl,
    relayServerId: input.relayServerId,
    storedRelayUrl: currentConfig.relay?.relayUrl,
  })

  const pendingClaim = await postRelayClaim(
    relayUrl,
    mintRelayToken({
      subject: `remote-host:${hostId}:claim`,
      purpose: 'pairing_claim',
      ttlMs: input.ttlMs,
    }).token,
    input.pairingCode,
  )
  const controllerToken = mintRelayToken({
    subject: `remote-host:${hostId}:controller`,
    purpose: 'ws',
    role: 'controller',
    roomId: pendingClaim.roomId,
    ttlMs: input.ttlMs,
  })
  const claimed = await postRelayClaim(
    relayUrl,
    mintRelayToken({
      subject: `remote-host:${hostId}:claim`,
      purpose: 'pairing_claim',
      ttlMs: input.ttlMs,
    }).token,
    input.pairingCode,
    controllerToken.token,
  )

  updateRemoteRuntimeHost(hostId, {
    transport: 'relay',
    connectionConfig: {
      ...currentConfig,
      transport: 'relay',
      relay: {
        relayUrl,
        roomId: claimed.roomId,
        controllerToken: controllerToken.token,
      },
    },
  })

  return {
    relayUrl,
    roomId: claimed.roomId,
    controllerToken: controllerToken.token,
    expiresAt: controllerToken.expiresAt,
  }
}

export async function callRemoteRuntimeHost<M extends RemoteAgentUnaryMethod>(
  hostId: string,
  method: M,
  params: RemoteAgentParams<M>,
): Promise<RemoteAgentResult<M>> {
  const record = requireConnectedRecord(hostId)
  try {
    return await record.client.call(method, params)
  }
  catch (error) {
    throw toAppError(error, 'remote_daemon_call_failed')
  }
}

export async function* openRemoteRuntimeHostStream<M extends RemoteAgentStreamMethod>(
  hostId: string,
  method: M,
  params: RemoteAgentParams<M>,
): AsyncGenerator<RemoteAgentStreamValue<M>, void, void> {
  const record = requireConnectedRecord(hostId)
  try {
    yield* record.client.openStream(method, params)
  }
  catch (error) {
    throw toAppError(error, 'remote_daemon_stream_failed')
  }
}

export function getRemoteRuntimeHostConnectionView(hostId: string): RemoteRuntimeHostConnectionView {
  const row = requireRemoteRuntimeHost(hostId)
  const record = connections.get(hostId)
  if (!record) {
    return {
      hostId,
      state: 'idle',
      localSocketPath: null,
      daemonHostId: row.lastDaemonHostId,
      daemonVersion: row.lastDaemonVersion,
      platform: row.lastPlatform,
      arch: row.lastArch,
      lastError: null,
    }
  }
  return toConnectionView(record)
}

async function connectRemoteRuntimeHostInner(hostId: string): Promise<RemoteRuntimeHostConnectionView> {
  const host = requireRemoteRuntimeHost(hostId)
  if (!host.enabled) {
    throw new AppError({
      code: 'remote_host_disabled',
      status: 409,
      message: 'Remote runtime host is disabled.',
      details: { hostId },
    })
  }

  await disconnectRemoteRuntimeHost(hostId)

  const connectionConfig = parseConnectionConfig(host.connectionConfigJson)
  const isRelay = connectionConfig.transport === 'relay'
  const localSocketPath = isRelay ? null : connectionConfig.localSocketPath ?? defaultLocalSocketPath(host.id)
  if (localSocketPath) {
    assertUnixSocketPathLength(localSocketPath)
  }
  let tunnel: SshTunnelHandle | null = null
  let record: RemoteRuntimeHostConnectionRecord | null = null

  try {
    if (connectionConfig.transport === 'ssh') {
      if (!localSocketPath) {
        throw new RemoteAgentTransportError('Local socket path is required for SSH transport.')
      }
      const sshLaunch = resolveHostSshLaunchConfig(host, connectionConfig)
      tunnel = await startSshTunnel({
        hostId: host.id,
        sshTarget: sshLaunch.sshTarget,
        localSocketPath,
        remoteSocketPath: host.remoteSocketPath,
        sshExecutable: sshLaunch.sshExecutable,
        sshArgs: sshLaunch.sshArgs,
        readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
      })
    }

    const client = isRelay
      ? await connectRelayDaemonClientWithRetry({
        relayConfig: requireRelayConfig(connectionConfig),
        timeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
        onTransportClose: (error) => {
          if (!record) {
            return
          }
          record.lastError = error.message
        },
      })
      : await connectDaemonClientWithRetry({
        socketPath: localSocketPath ?? '',
        timeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
        onTransportClose: (error) => {
          if (!record) {
            return
          }
          record.lastError = error.message
        },
      })

    record = {
      host,
      client,
      tunnel,
      localSocketPath,
      lastError: null,
      tunnelExited: false,
    }
    tunnel?.onExit((exit) => {
      if (!record) {
        return
      }
      record.tunnelExited = true
      record.lastError = `ssh tunnel exited with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'null'}`
      void record.client?.close()
    })
    connections.set(hostId, record)
    persistDaemonIdentity(hostId, client.hello)
    return toConnectionView(record)
  }
  catch (error) {
    await tunnel?.close()
    const appError = toAppError(error, 'remote_host_connect_failed')
    connections.set(hostId, {
      host,
      client: null,
      tunnel: null,
      localSocketPath,
      lastError: appError.message,
      tunnelExited: true,
    })
    throw appError
  }
}

async function connectDaemonClientWithRetry(input: {
  socketPath: string
  timeoutMs: number
  onTransportClose: (error: RemoteAgentTransportError) => void
}): Promise<RemoteAgentDaemonClient> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    const client = createRemoteAgentDaemonClient({
      socketPath: input.socketPath,
      onTransportClose: input.onTransportClose,
    })
    try {
      await client.connect()
      return client
    }
    catch (error) {
      lastError = error
      await client.close()
      await delay(150)
    }
  }
  throw lastError ?? new RemoteAgentTransportError('Timed out connecting to remote daemon.')
}

function requireRemoteRuntimeHost(hostId: string): RemoteRuntimeHost {
  const host = db()
    .select()
    .from(remoteRuntimeHosts)
    .where(eq(remoteRuntimeHosts.id, hostId))
    .get()
  if (!host) {
    throw new AppError({
      code: 'remote_host_not_found',
      status: 404,
      message: 'Remote runtime host was not found.',
      details: { hostId },
    })
  }
  return host
}

function requireConnectedRecord(hostId: string): RemoteRuntimeHostConnectionRecord & { client: RemoteAgentDaemonClient } {
  requireRemoteRuntimeHost(hostId)
  const record = connections.get(hostId)
  if (!record || !record.client || connectionStateOf(record) !== 'connected') {
    throw new AppError({
      code: 'remote_host_offline',
      status: 503,
      message: 'Remote runtime host is not connected.',
      details: {
        hostId,
        state: record ? connectionStateOf(record) : 'idle',
        lastError: record?.lastError ?? null,
      },
    })
  }
  return { ...record, client: record.client }
}

function toHostView(row: RemoteRuntimeHost): RemoteRuntimeHostView {
  const record = connections.get(row.id)
  return {
    ...row,
    connectionState: record ? connectionStateOf(record) : 'idle',
    lastError: record?.lastError ?? null,
  }
}

function toConnectionView(record: RemoteRuntimeHostConnectionRecord): RemoteRuntimeHostConnectionView {
  const hello = record.client?.hello
  return {
    hostId: record.host.id,
    state: connectionStateOf(record),
    localSocketPath: record.localSocketPath,
    daemonHostId: hello?.hostId ?? record.host.lastDaemonHostId,
    daemonVersion: hello?.daemonVersion ?? record.host.lastDaemonVersion,
    platform: hello?.platform ?? record.host.lastPlatform,
    arch: hello?.arch ?? record.host.lastArch,
    lastError: record.lastError,
  }
}

function connectionStateOf(record: RemoteRuntimeHostConnectionRecord): RemoteRuntimeHostConnectionState {
  if (record.tunnelExited) {
    return 'offline'
  }
  return record.client?.state ?? 'offline'
}

function persistDaemonIdentity(hostId: string, hello: RemoteAgentDaemonClient['hello']): void {
  if (!hello) {
    return
  }
  db()
    .update(remoteRuntimeHosts)
    .set({
      lastDaemonHostId: hello.hostId,
      lastDaemonVersion: hello.daemonVersion,
      lastPlatform: hello.platform,
      lastArch: hello.arch,
      lastSeenAt: currentUnixSeconds(),
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(remoteRuntimeHosts.id, hostId))
    .run()
}

function parseConnectionConfig(raw: string): RemoteRuntimeHostConnectionConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_remote_host_connection_config',
      status: 400,
      message: 'Remote runtime host connection config is invalid.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
  return normalizeConnectionConfig(parsed)
}

function normalizeRemoteRuntimeHostConnection(
  input: RemoteRuntimeHostConnectionPatch,
  current: RemoteRuntimeHost | null,
): NormalizedRemoteRuntimeHostConnection {
  const baseConfig = input.connectionConfig !== undefined
    ? input.connectionConfig
    : current
      ? parseConnectionConfig(current.connectionConfigJson)
      : {}
  const connectionConfig = normalizeConnectionConfig(mergeConnectionConfigInput(baseConfig, input))
  return {
    sshTarget: resolveStoredSshTarget({
      explicitSshTarget: input.sshTarget,
      connectionConfig,
      currentSshTarget: current?.sshTarget ?? null,
    }),
    remoteSocketPath: normalizeRemoteSocketPath(input.remoteSocketPath, current),
    connectionConfigJson: JSON.stringify(connectionConfig),
  }
}

function normalizeConnectionConfig(raw: unknown): RemoteRuntimeHostConnectionConfig {
  try {
    return connectionConfigSchema.parse(raw)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_remote_host_connection_config',
      status: 400,
      message: 'Remote runtime host connection config is invalid.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function mergeConnectionConfigInput(
  base: Record<string, unknown>,
  input: RemoteRuntimeHostConnectionPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  if (input.transport !== undefined) {
    next.transport = input.transport
  }
  if (input.sshProfile !== undefined) {
    if (input.sshProfile === null) {
      delete next.ssh
    }
    else {
      next.ssh = input.sshProfile
    }
  }
  if (input.localSocketPath !== undefined) {
    next.localSocketPath = input.localSocketPath
  }
  if (input.connectTimeoutMs !== undefined) {
    next.connectTimeoutMs = input.connectTimeoutMs
  }
  return next
}

function resolveStoredSshTarget(input: {
  explicitSshTarget?: string
  connectionConfig: RemoteRuntimeHostConnectionConfig
  currentSshTarget: string | null
}): string {
  const explicitSshTarget = input.explicitSshTarget?.trim()
  if (explicitSshTarget) {
    return explicitSshTarget
  }
  if (input.connectionConfig.ssh) {
    return buildSshProfileLaunchConfig(input.connectionConfig.ssh).sshTarget
  }
  if (input.currentSshTarget) {
    return input.currentSshTarget
  }
  if (input.connectionConfig.transport === 'direct-socket') {
    return 'direct-socket'
  }
  if (input.connectionConfig.transport === 'relay') {
    return 'relay'
  }
  throw new AppError({
    code: 'remote_host_ssh_profile_required',
    status: 400,
    message: 'Remote runtime host requires either sshTarget or sshProfile for SSH transport.',
  })
}

function normalizeRemoteSocketPath(
  remoteSocketPath: string | undefined,
  current: RemoteRuntimeHost | null,
): string {
  const explicitRemoteSocketPath = remoteSocketPath?.trim()
  if (explicitRemoteSocketPath) {
    return explicitRemoteSocketPath
  }
  return current?.remoteSocketPath ?? DEFAULT_REMOTE_DAEMON_SOCKET_PATH
}

function hasConnectionPatch(patch: UpdateRemoteRuntimeHostInput): boolean {
  return patch.sshTarget !== undefined
    || patch.remoteSocketPath !== undefined
    || patch.transport !== undefined
    || patch.sshProfile !== undefined
    || patch.localSocketPath !== undefined
    || patch.connectTimeoutMs !== undefined
    || patch.connectionConfig !== undefined
}

function inferConnectionTransport(config: ConnectionConfigTransportFields): RemoteRuntimeHostTransport {
  if (config.transport) {
    return config.transport
  }
  if (config.relay) {
    return 'relay'
  }
  if (config.localSocketPath && !config.ssh) {
    return 'direct-socket'
  }
  return 'ssh'
}

export function buildSshProfileLaunchConfig(profile: RemoteRuntimeHostSshProfile): SshProfileLaunchConfig {
  const sshArgs: string[] = []
  if (profile.port !== null) {
    sshArgs.push('-p', String(profile.port))
  }
  if (profile.auth === 'identityFile' && profile.identityFilePath) {
    sshArgs.push('-i', profile.identityFilePath)
  }
  return {
    sshTarget: profile.user ? `${profile.user}@${profile.hostName}` : profile.hostName,
    sshArgs,
  }
}

function resolveHostSshLaunchConfig(
  host: RemoteRuntimeHost,
  connectionConfig: RemoteRuntimeHostConnectionConfig,
): {
  sshTarget: string
  sshExecutable?: string
  sshArgs: string[]
} {
  const profileLaunch = connectionConfig.ssh
    ? buildSshProfileLaunchConfig(connectionConfig.ssh)
    : { sshTarget: host.sshTarget, sshArgs: [] }
  return {
    sshTarget: profileLaunch.sshTarget,
    sshExecutable: connectionConfig.sshExecutable,
    sshArgs: [
      ...profileLaunch.sshArgs,
      ...(connectionConfig.sshArgs ?? []),
    ],
  }
}

function defaultLocalSocketPath(hostId: string): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  const dir = join('/tmp', `cradle-rrh-${uid}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, `${hostId}.sock`)
}

function assertUnixSocketPathLength(socketPath: string): void {
  const byteLength = Buffer.byteLength(socketPath)
  if (byteLength <= UNIX_SOCKET_PATH_LIMIT) {
    return
  }
  throw new AppError({
    code: 'remote_host_local_socket_path_too_long',
    status: 400,
    message: 'Remote runtime local Unix socket path is too long for this operating system.',
    details: {
      socketPath,
      byteLength,
      limit: UNIX_SOCKET_PATH_LIMIT,
      suggestion: 'Use a shorter connectionConfig.localSocketPath such as /tmp/cradle-agentd.sock.',
    },
  })
}

function toAppError(error: unknown, fallbackCode: string): AppError {
  if (error instanceof AppError) {
    return error
  }
  if (error instanceof RemoteAgentRpcError) {
    return new AppError({
      code: error.code,
      status: 502,
      message: error.message,
      details: error.details && typeof error.details === 'object'
        ? error.details as Record<string, unknown>
        : { details: error.details },
    })
  }
  if (error instanceof RemoteAgentTransportError) {
    return new AppError({
      code: error.code,
      status: 503,
      message: error.message,
    })
  }
  return new AppError({
    code: fallbackCode,
    status: 502,
    message: error instanceof Error ? error.message : String(error),
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function connectRelayDaemonClientWithRetry(input: {
  relayConfig: RemoteRuntimeHostRelayConfig
  timeoutMs: number
  onTransportClose: (error: RemoteAgentTransportError) => void
}): Promise<RemoteAgentDaemonClient> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    const client = createRelayRemoteAgentDaemonClient({
      relayUrl: input.relayConfig.relayUrl,
      roomId: input.relayConfig.roomId,
      controllerToken: input.relayConfig.controllerToken,
      onTransportClose: input.onTransportClose,
    })
    try {
      await client.connect()
      return client
    }
    catch (error) {
      lastError = error
      await client.close()
      await delay(150)
    }
  }
  throw lastError ?? new RemoteAgentTransportError('Timed out connecting to remote relay.')
}

function requireRelayConfig(config: RemoteRuntimeHostConnectionConfig): RemoteRuntimeHostRelayConfig {
  if (!config.relay) {
    throw new AppError({
      code: 'remote_relay_config_required',
      status: 400,
      message: 'Remote runtime host relay config is required for relay transport.',
    })
  }
  return config.relay
}

async function postRelayClaim(
  relayUrl: string,
  claimToken: string,
  pairingCode: string,
  controllerToken?: string,
): Promise<{ roomId: string }> {
  const response = await fetch(new URL('/pairing/claim', ensureTrailingSlash(relayUrl)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${claimToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pairingCode,
      ...(controllerToken ? { controllerToken } : {}),
    }),
  })
  if (!response.ok) {
    throw new AppError({
      code: 'remote_relay_claim_failed',
      status: 502,
      message: `Relay pairing claim failed with HTTP ${response.status}.`,
    })
  }
  return await response.json() as { roomId: string }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
