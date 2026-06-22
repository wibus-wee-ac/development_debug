import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
import { db, getServerConfig } from '../../infra'
import {
  createRemoteAgentDaemonClient,
  RemoteAgentRpcError,
  RemoteAgentTransportError,
  type RemoteAgentDaemonClient,
  type RemoteRuntimeHostConnectionState,
} from './daemon-client'
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
  sshTarget: string
  remoteSocketPath: string
  enabled?: boolean
  connectionConfig?: Record<string, unknown>
}

export interface UpdateRemoteRuntimeHostInput {
  displayName?: string
  sshTarget?: string
  remoteSocketPath?: string
  enabled?: boolean
  connectionConfig?: Record<string, unknown>
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
  client: RemoteAgentDaemonClient
  tunnel: SshTunnelHandle | null
  localSocketPath: string
  lastError: string | null
  tunnelExited: boolean
}

const connectionConfigSchema = z.object({
  localSocketPath: z.string().trim().min(1).optional(),
  sshExecutable: z.string().trim().min(1).optional(),
  sshArgs: z.array(z.string()).optional(),
  connectTimeoutMs: z.number().int().positive().max(120_000).optional(),
}).passthrough()

type RemoteRuntimeHostConnectionConfig = z.infer<typeof connectionConfigSchema>

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
  const row = db()
    .insert(remoteRuntimeHosts)
    .values({
      id: input.id ?? randomUUID(),
      displayName: input.displayName.trim(),
      sshTarget: input.sshTarget.trim(),
      remoteSocketPath: input.remoteSocketPath.trim(),
      enabled: input.enabled ?? true,
      connectionConfigJson: JSON.stringify(input.connectionConfig ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  return toHostView(row)
}

export function updateRemoteRuntimeHost(hostId: string, patch: UpdateRemoteRuntimeHostInput): RemoteRuntimeHostView {
  requireRemoteRuntimeHost(hostId)
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
  if (patch.connectionConfig !== undefined) {
    update.connectionConfigJson = JSON.stringify(patch.connectionConfig)
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
  await record.client.close()
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
  const localSocketPath = connectionConfig.localSocketPath ?? defaultLocalSocketPath(host.id)
  let tunnel: SshTunnelHandle | null = null
  let record: RemoteRuntimeHostConnectionRecord | null = null

  try {
    if (!connectionConfig.localSocketPath) {
      tunnel = await startSshTunnel({
        hostId: host.id,
        sshTarget: host.sshTarget,
        localSocketPath,
        remoteSocketPath: host.remoteSocketPath,
        sshExecutable: connectionConfig.sshExecutable,
        sshArgs: connectionConfig.sshArgs,
      })
    }

    const client = await connectDaemonClientWithRetry({
      socketPath: localSocketPath,
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
      void record.client.close()
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
      client: createRemoteAgentDaemonClient({ socketPath: localSocketPath }),
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

function requireConnectedRecord(hostId: string): RemoteRuntimeHostConnectionRecord {
  requireRemoteRuntimeHost(hostId)
  const record = connections.get(hostId)
  if (!record || connectionStateOf(record) !== 'connected') {
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
  return record
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
  const hello = record.client.hello
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
  return record.client.state
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
  try {
    return connectionConfigSchema.parse(JSON.parse(raw))
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

function defaultLocalSocketPath(hostId: string): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  const dir = join(baseDir, 'remote-runtime-hosts')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${hostId}.sock`)
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

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
