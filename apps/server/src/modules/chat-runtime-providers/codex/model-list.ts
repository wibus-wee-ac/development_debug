import type { ModelDescriptor } from '../../provider-contracts/types'
import type { ModelListResponse } from './app-server-protocol/v2/ModelListResponse'
import type { CodexAppServerClientOptions } from './app-server-client'
import { CodexAppServerClient } from './app-server-client'
import {
  buildCodexChatgptAuthLoginParams,
  ensureCodexChatgptAuthAccessToken,
  type CodexChatgptAuthCredential,
} from './chatgpt-auth'
import type { CodexAppServerClientLike } from './types'

type ReasoningEffort = NonNullable<ModelDescriptor['capabilities']['reasoningEfforts']>[number]

let createClientForTests: ((options?: CodexAppServerClientOptions) => CodexAppServerClientLike) | null = null

export async function listCodexChatgptModels(input: {
  credential: CodexChatgptAuthCredential
  updateSecretValue?: (credentialRef: string, secret: string) => void
}): Promise<ModelDescriptor[]> {
  const client = createClientForTests?.() ?? new CodexAppServerClient()
  try {
    await client.initialize()
    const credential = await ensureCodexChatgptAuthAccessToken(input.credential, {
      updateSecretValue: input.updateSecretValue,
    })
    await client.request('account/login/start', buildCodexChatgptAuthLoginParams(credential))
    const response = await client.request('model/list', {
      includeHidden: true,
      limit: 100,
    }) as ModelListResponse
    return response.data
      .map(model => ({
        id: model.id || model.model,
        label: model.displayName || model.id || model.model,
        providerKind: 'openai-compatible' as const,
        capabilities: {
          inputModalities: Array.isArray(model.inputModalities)
            ? model.inputModalities.map(modality => String(modality))
            : [],
          reasoning: Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length > 0,
          reasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
            ? model.supportedReasoningEfforts
                .map(option => option.reasoningEffort)
                .filter(isModelDescriptorReasoningEffort)
            : [],
        },
      }))
      .filter(model => model.id)
  }
  finally {
    client.close()
  }
}

export function setCodexChatgptModelListClientFactoryForTests(
  factory: ((options?: CodexAppServerClientOptions) => CodexAppServerClientLike) | null,
): void {
  createClientForTests = factory
}

function isModelDescriptorReasoningEffort(effort: string): effort is ReasoningEffort {
  return effort === 'none'
    || effort === 'minimal'
    || effort === 'low'
    || effort === 'medium'
    || effort === 'high'
    || effort === 'xhigh'
    || effort === 'max'
}
