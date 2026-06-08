import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config'
import { buildSlackSessionCreateBody, enabledAgentTargets } from '../src/cradle/service'
import type { GetAgentsResponse } from '../src/generated/cradle-api'

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
})
