import type { WorkspaceBinding } from '../db/schema'
import type { ProviderModelSummary, SessionTargetSummary } from '../cradle/service'
import type { SlackBlockMessage } from './format'

export const CRADLE_SESSION_TARGET_SELECT_ACTION = 'cradle_session_target_select'
export const CRADLE_SESSION_MODEL_SELECT_ACTION = 'cradle_session_model_select'

const OPTION_LIMIT = 100
const DEFAULT_MODEL_VALUE = '__cradle_default_model__'

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncatePlainText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

export function sessionTargetValue(target: Pick<SessionTargetSummary, 'kind' | 'id' | 'runtimeKind'>): string {
  if (target.kind === 'provider-target') {
    const runtimeKind = target.runtimeKind ?? 'standard'
    return `${target.kind}:${runtimeKind}:${target.id}`
  }
  return `${target.kind}:${target.id}`
}

export function parseSessionTargetValue(value: string): {
  kind: SessionTargetSummary['kind']
  id: string
  runtimeKind: string | null
} | null {
  if (value.startsWith('agent:')) {
    const id = value.slice('agent:'.length)
    return id ? { kind: 'agent', id, runtimeKind: null } : null
  }

  if (!value.startsWith('provider-target:')) {
    return null
  }

  const remainder = value.slice('provider-target:'.length)
  const separatorIndex = remainder.indexOf(':')
  const runtimeKind = separatorIndex > 0 ? remainder.slice(0, separatorIndex) : ''
  const id = remainder.slice(separatorIndex + 1)
  if (!runtimeKind || !id) {
    return null
  }

  return {
    kind: 'provider-target',
    id,
    runtimeKind,
  }
}

export function sessionModelValue(modelId: string | null): string {
  return modelId ?? DEFAULT_MODEL_VALUE
}

export function parseSessionModelValue(value: string): string | null {
  return value === DEFAULT_MODEL_VALUE ? null : value
}

export function selectedTargetForBinding(
  binding: WorkspaceBinding | null,
  targets: SessionTargetSummary[],
): SessionTargetSummary | null {
  if (!binding) {
    return null
  }
  if (binding.sessionAgentId) {
    return targets.find(target => target.kind === 'agent' && target.id === binding.sessionAgentId) ?? null
  }
  if (binding.sessionProviderTargetId) {
    const runtimeKind = binding.sessionRuntimeKind ?? 'standard'
    return targets.find(target =>
      target.kind === 'provider-target'
      && target.id === binding.sessionProviderTargetId
      && (target.runtimeKind ?? 'standard') === runtimeKind) ?? null
  }
  return null
}

function runtimeLabelForTarget(target: SessionTargetSummary): string {
  if (target.runtimeLabel) {
    return target.runtimeLabel
  }
  if (target.runtimeKind === 'standard' || !target.runtimeKind) {
    return 'Standard'
  }
  return target.runtimeKind
}

export function sessionTargetLabel(target: SessionTargetSummary): string {
  return target.kind === 'agent'
    ? `Agent: ${target.label}`
    : `${runtimeLabelForTarget(target)}: ${target.label}`
}

function sessionTargetDescription(target: SessionTargetSummary): string {
  if (target.kind === 'agent') {
    return [target.runtimeKind, target.modelId].filter(Boolean).join(' - ') || 'Agent default runtime'
  }
  return target.description ?? 'Provider target'
}

function sessionTargetOption(target: SessionTargetSummary) {
  return {
    text: {
      type: 'plain_text' as const,
      text: truncatePlainText(sessionTargetLabel(target), 75),
    },
    description: {
      type: 'plain_text' as const,
      text: truncatePlainText(sessionTargetDescription(target), 75),
    },
    value: sessionTargetValue(target),
  }
}

function sessionModelOption(model: ProviderModelSummary | null) {
  if (!model) {
    return {
      text: {
        type: 'plain_text' as const,
        text: 'Use default model',
      },
      description: {
        type: 'plain_text' as const,
        text: 'Let the selected agent or provider choose',
      },
      value: DEFAULT_MODEL_VALUE,
    }
  }
  return {
    text: {
      type: 'plain_text' as const,
      text: truncatePlainText(model.label || model.id, 75),
    },
    description: {
      type: 'plain_text' as const,
      text: truncatePlainText(model.id, 75),
    },
    value: sessionModelValue(model.id),
  }
}

export function buildSessionTargetSelectBlocks(input: {
  binding: WorkspaceBinding | null
  targets: SessionTargetSummary[]
  models?: ProviderModelSummary[]
  prompt: string
}): SlackBlockMessage['blocks'] {
  const options = input.targets.slice(0, OPTION_LIMIT).map(sessionTargetOption)
  if (!options.length) {
    return [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${input.prompt}\n\nNo enabled Cradle agents or provider targets are available.`,
      },
    }]
  }

  const selected = selectedTargetForBinding(input.binding, input.targets)
  const initialOption = selected ? sessionTargetOption(selected) : undefined
  const blocks: SlackBlockMessage['blocks'] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: input.prompt,
      },
    },
    {
      type: 'actions',
      elements: [{
        type: 'static_select',
        action_id: CRADLE_SESSION_TARGET_SELECT_ACTION,
        placeholder: {
          type: 'plain_text',
          text: 'Choose Cradle runtime',
        },
        options,
        ...(initialOption ? { initial_option: initialOption } : {}),
      }],
    },
  ]
  if (selected) {
    blocks.push(...buildSessionModelSelectBlocks({
      binding: input.binding,
      models: input.models ?? [],
      prompt: '*Default model for new Slack threads*',
    }))
  }
  return blocks
}

export function buildSessionModelSelectBlocks(input: {
  binding: WorkspaceBinding | null
  models: ProviderModelSummary[]
  prompt: string
}): SlackBlockMessage['blocks'] {
  const options = [
    sessionModelOption(null),
    ...input.models.slice(0, OPTION_LIMIT - 1).map(sessionModelOption),
  ]
  const selectedModel = input.binding?.sessionModelId
    ? input.models.find(model => model.id === input.binding?.sessionModelId) ?? null
    : null
  const initialOption = selectedModel
    ? sessionModelOption(selectedModel)
    : sessionModelOption(null)
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: input.models.length
          ? input.prompt
          : `${input.prompt}\n\nNo cached models are available for the selected runtime yet.`,
      },
    },
    {
      type: 'actions',
      elements: [{
        type: 'static_select',
        action_id: CRADLE_SESSION_MODEL_SELECT_ACTION,
        placeholder: {
          type: 'plain_text',
          text: 'Choose model',
        },
        options,
        initial_option: initialOption,
      }],
    },
  ]
}

export function describeSessionTarget(binding: WorkspaceBinding | null, targets: SessionTargetSummary[]): string {
  const selected = selectedTargetForBinding(binding, targets)
  if (selected) {
    return escapeSlackText(sessionTargetLabel(selected))
  }
  if (binding?.sessionAgentId) {
    return `Agent: \`${escapeSlackText(binding.sessionAgentId)}\``
  }
  if (binding?.sessionProviderTargetId) {
    return `${escapeSlackText(binding.sessionRuntimeKind ?? 'standard')}: \`${escapeSlackText(binding.sessionProviderTargetId)}\``
  }
  return 'Not selected'
}

export function describeSessionModel(binding: WorkspaceBinding | null, models: ProviderModelSummary[]): string {
  if (!binding?.sessionModelId) {
    return 'Default'
  }
  const model = models.find(candidate => candidate.id === binding.sessionModelId)
  return escapeSlackText(model?.label || binding.sessionModelId)
}
