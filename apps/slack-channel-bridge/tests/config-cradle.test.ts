import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config'
import { buildSlackSessionCreateBody, enabledAgentTargets, enabledProviderRuntimeTargets } from '../src/cradle/service'
import type { GetAgentsResponse, GetChatRuntimesResponse, GetProviderTargetsResponse } from '../src/generated/cradle-api'

const baseEnv = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  SLACK_SIGNING_SECRET: 'secret',
  CRADLE_API_BASE_URL: 'http://127.0.0.1:21423',
  SLACK_CHANNEL_BRIDGE_DB_PATH: '/tmp/slack-channel-bridge-config-test.sqlite',
}

describe('Cradle session defaults', () => {
  it('allows Slack Block UI channel selection without env session defaults', () => {
    expect(loadConfig(baseEnv)).toMatchObject({
      cradleAgentId: null,
      cradleProviderTargetId: null,
    })
  })

  it('builds an agent-backed session create body', () => {
    expect(buildSlackSessionCreateBody({
      workspaceId: 'workspace_1',
      title: 'Slack: hello',
    }, {
      agentId: 'agent_1',
      providerTargetId: 'provider_ignored',
      modelId: 'model_1',
    })).toEqual({
      workspaceId: 'workspace_1',
      title: 'Slack: hello',
      agentId: 'agent_1',
      modelId: 'model_1',
    })
  })

  it('builds a provider-backed session create body', () => {
    expect(buildSlackSessionCreateBody({
      workspaceId: 'workspace_1',
      title: 'Slack: hello',
    }, {
      providerTargetId: 'provider_1',
      runtimeKind: 'standard',
      modelId: 'model_1',
    })).toEqual({
      workspaceId: 'workspace_1',
      title: 'Slack: hello',
      providerTargetId: 'provider_1',
      runtimeKind: 'standard',
      modelId: 'model_1',
    })
  })

  it('excludes CLI TUI agents from Slack-selectable session targets', () => {
    const agents = [{
      id: 'agent_codex',
      name: 'Codex',
      description: null,
      avatarUrl: null,
      avatarStyle: 'initials',
      avatarSeed: 'codex',
      providerTargetId: 'provider_1',
      modelId: null,
      thinkingEffort: 'medium',
      runtimeKind: 'codex',
      configJson: '{}',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    }, {
      id: 'agent_tui',
      name: 'Terminal',
      description: null,
      avatarUrl: null,
      avatarStyle: 'initials',
      avatarSeed: 'terminal',
      providerTargetId: null,
      modelId: null,
      thinkingEffort: 'medium',
      runtimeKind: 'cli-tui',
      configJson: '{}',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    }] satisfies GetAgentsResponse

    expect(enabledAgentTargets(agents).map(target => target.id)).toEqual(['agent_codex'])
  })

  it('expands provider targets into compatible chat runtimes', () => {
    const providerTargets = [{
      id: 'openai_target',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'OpenAI',
      enabled: true,
      iconSlug: null,
      connectionConfigJson: '{}',
      credentialRef: null,
      enabledModelsJson: '[]',
      customModelsJson: '[]',
      sourceKey: null,
      externalRecordId: null,
      sourceFingerprint: null,
      createdAt: 1,
      updatedAt: 1,
    }, {
      id: 'anthropic_target',
      kind: 'manual',
      providerKind: 'anthropic',
      displayName: 'Anthropic',
      enabled: true,
      iconSlug: null,
      connectionConfigJson: '{}',
      credentialRef: null,
      enabledModelsJson: '[]',
      customModelsJson: '[]',
      sourceKey: null,
      externalRecordId: null,
      sourceFingerprint: null,
      createdAt: 1,
      updatedAt: 1,
    }, {
      id: 'disabled_target',
      kind: 'manual',
      providerKind: 'universal',
      displayName: 'Disabled',
      enabled: false,
      iconSlug: null,
      connectionConfigJson: '{}',
      credentialRef: null,
      enabledModelsJson: '[]',
      customModelsJson: '[]',
      sourceKey: null,
      externalRecordId: null,
      sourceFingerprint: null,
      createdAt: 1,
      updatedAt: 1,
    }] satisfies GetProviderTargetsResponse
    const runtimes = {
      items: [{
        runtimeKind: 'standard',
        label: 'Standard',
        providerKinds: ['openai-compatible', 'universal'],
        surfaces: ['chat'],
        source: 'builtin',
        pluginOwner: null,
      }, {
        runtimeKind: 'codex',
        label: 'Codex',
        providerKinds: ['openai-compatible', 'universal'],
        surfaces: ['chat'],
        source: 'builtin',
        pluginOwner: null,
      }, {
        runtimeKind: 'claude-agent',
        label: 'Claude Agent',
        providerKinds: ['anthropic', 'universal'],
        surfaces: ['chat'],
        source: 'builtin',
        pluginOwner: null,
      }, {
        runtimeKind: 'jar-core',
        label: 'HiJarvis',
        providerKinds: ['openai-compatible', 'anthropic', 'universal'],
        surfaces: ['jarvis'],
        source: 'builtin',
        pluginOwner: null,
      }],
    } satisfies GetChatRuntimesResponse

    expect(enabledProviderRuntimeTargets(providerTargets, runtimes).map(target => ({
      id: target.id,
      runtimeKind: target.runtimeKind,
      label: target.runtimeLabel,
    }))).toEqual([
      { id: 'openai_target', runtimeKind: 'standard', label: 'Standard' },
      { id: 'openai_target', runtimeKind: 'codex', label: 'Codex' },
      { id: 'anthropic_target', runtimeKind: 'claude-agent', label: 'Claude Agent' },
    ])
  })
})
