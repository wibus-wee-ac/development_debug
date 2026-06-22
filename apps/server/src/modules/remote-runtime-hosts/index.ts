import { Elysia, t } from 'elysia'

import { RemoteRuntimeHostsModel } from './model'
import * as RemoteRuntimeHosts from './service'

export const remoteRuntimeHosts = new Elysia({
  prefix: '/remote-runtime-hosts',
  detail: { tags: ['remote-runtime-hosts'] },
})
  .get('', () => RemoteRuntimeHosts.listRemoteRuntimeHosts(), {
    detail: {
      'summary': 'List remote runtime hosts',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'list'],
      },
    },
    response: { 200: t.Array(RemoteRuntimeHostsModel.host) },
  })
  .post('', ({ body }) => RemoteRuntimeHosts.createRemoteRuntimeHost({
    id: body.id,
    displayName: body.displayName,
    sshTarget: body.sshTarget,
    remoteSocketPath: body.remoteSocketPath,
    enabled: body.enabled,
    transport: body.transport,
    sshProfile: body.sshProfile,
    localSocketPath: body.localSocketPath,
    connectTimeoutMs: body.connectTimeoutMs,
    connectionConfig: body.connectionConfig,
  }), {
    detail: {
      'summary': 'Create a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'create'],
      },
    },
    body: RemoteRuntimeHostsModel.createHostBody,
    response: { 200: RemoteRuntimeHostsModel.host },
  })
  .patch('/:hostId', ({ params, body }) => RemoteRuntimeHosts.updateRemoteRuntimeHost(params.hostId, {
    displayName: body.displayName,
    sshTarget: body.sshTarget,
    remoteSocketPath: body.remoteSocketPath,
    enabled: body.enabled,
    transport: body.transport,
    sshProfile: body.sshProfile,
    localSocketPath: body.localSocketPath,
    connectTimeoutMs: body.connectTimeoutMs,
    connectionConfig: body.connectionConfig,
  }), {
    detail: {
      'summary': 'Update a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'update'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    body: RemoteRuntimeHostsModel.updateHostBody,
    response: { 200: RemoteRuntimeHostsModel.host },
  })
  .delete('/:hostId', async ({ params }) => {
    await RemoteRuntimeHosts.deleteRemoteRuntimeHost(params.hostId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'delete'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    response: { 200: RemoteRuntimeHostsModel.ok },
  })
  .post('/:hostId/connect', ({ params }) => RemoteRuntimeHosts.connectRemoteRuntimeHost(params.hostId), {
    detail: {
      'summary': 'Connect to a remote runtime host daemon',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'connect'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    response: { 200: RemoteRuntimeHostsModel.connection },
  })
  .post('/:hostId/disconnect', async ({ params }) => {
    await RemoteRuntimeHosts.disconnectRemoteRuntimeHost(params.hostId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Disconnect from a remote runtime host daemon',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'disconnect'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    response: { 200: RemoteRuntimeHostsModel.ok },
  })
  .get('/:hostId/health', ({ params }) => RemoteRuntimeHosts.readRemoteRuntimeHostHealth(params.hostId), {
    detail: {
      'summary': 'Read remote runtime host daemon health',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'health'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    response: { 200: RemoteRuntimeHostsModel.health },
  })
  .get('/:hostId/runtimes', ({ params }) => RemoteRuntimeHosts.listRemoteRuntimes(params.hostId), {
    detail: {
      'summary': 'List runtimes exposed by a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'runtime', 'list'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    response: { 200: RemoteRuntimeHostsModel.runtimeList },
  })
  .get('/:hostId/workspaces', ({ params, query }) => RemoteRuntimeHosts.listRemoteWorkspaces(params.hostId, {
    root: query.root ?? null,
  }), {
    detail: {
      'summary': 'List workspaces exposed by a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'workspace', 'list'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    query: RemoteRuntimeHostsModel.workspaceQuery,
    response: { 200: RemoteRuntimeHostsModel.workspaceList },
  })
  .get('/:hostId/agents', ({ params }) => RemoteRuntimeHosts.listRemoteAgents(params.hostId), {
    detail: {
      'summary': 'List live agents on a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'agent', 'list'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    response: { 200: RemoteRuntimeHostsModel.agentList },
  })
  .post('/:hostId/agents', ({ params, body }) => RemoteRuntimeHosts.startRemoteAgent(params.hostId, {
    runtimeKind: body.runtimeKind,
    workspacePath: body.workspacePath,
    chatSessionId: body.chatSessionId ?? null,
    providerSessionId: body.providerSessionId ?? null,
    modelId: body.modelId ?? null,
  }), {
    detail: {
      'summary': 'Start a mock remote agent on a remote runtime host',
      'x-cradle-cli': {
        command: ['remote-runtime-host', 'agent', 'start'],
      },
    },
    params: RemoteRuntimeHostsModel.hostIdParams,
    body: RemoteRuntimeHostsModel.startAgentBody,
    response: { 200: RemoteRuntimeHostsModel.startAgentResponse },
  })
