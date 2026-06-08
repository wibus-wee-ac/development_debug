import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config'
import { buildSlackSessionCreateBody } from '../src/cradle/service'

const baseEnv = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  SLACK_SIGNING_SECRET: 'secret',
  CRADLE_API_BASE_URL: 'http://127.0.0.1:21423',
}

describe('Cradle session defaults', () => {
  it('fails fast when no agent or provider target is configured', () => {
    expect(() => loadConfig(baseEnv)).toThrow(/CRADLE_SLACK_AGENT_ID or CRADLE_SLACK_PROVIDER_TARGET_ID/)
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
})
