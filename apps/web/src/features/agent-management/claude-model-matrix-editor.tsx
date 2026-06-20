import {
  ArrowRightUpLine as PassthroughIcon,
  BrainLine as OpusIcon,
  FlashLine as HaikuIcon,
  SparklesLine as SonnetIcon,
} from '@mingcute/react'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { ClaudeAgentAliasKey, ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  CLAUDE_AGENT_ALIAS_KEYS,
  DEFAULT_CLAUDE_AGENT_ALIASES,
} from '~/features/agent-runtime/claude-agent-config'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import { SettingsDivider } from '../settings/settings-row'

const CURRENT_MODEL_VALUE = '__cradle_current_model__'

interface TierMeta {
  key: ClaudeAgentAliasKey
  label: string
  description: string
  glyph: typeof HaikuIcon
  accent: {
    text: string
    chip: string
    chipActive: string
    rail: string
    bar: string
  }
}

const TIERS: TierMeta[] = [
  {
    key: 'haiku',
    label: 'Haiku',
    description: 'Fast · lightweight',
    glyph: HaikuIcon,
    accent: {
      text: 'text-emerald-600 dark:text-emerald-400',
      chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      chipActive: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/35',
      rail: 'bg-emerald-500/4',
      bar: 'bg-emerald-500/60',
    },
  },
  {
    key: 'sonnet',
    label: 'Sonnet',
    description: 'Balanced',
    glyph: SonnetIcon,
    accent: {
      text: 'text-violet-600 dark:text-violet-400',
      chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      chipActive: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/35',
      rail: 'bg-violet-500/4',
      bar: 'bg-violet-500/60',
    },
  },
  {
    key: 'opus',
    label: 'Opus',
    description: 'Smart · heavy',
    glyph: OpusIcon,
    accent: {
      text: 'text-amber-600 dark:text-amber-400',
      chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      chipActive: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/35',
      rail: 'bg-amber-500/4',
      bar: 'bg-amber-500/60',
    },
  },
]

function modelLabel(model: ModelDescriptor): string {
  return model.label || model.id
}

function dedupeModelOptions(input: Array<{ id: string, label: string }>): Array<{ id: string, label: string }> {
  const seen = new Set<string>()
  return input.filter((model) => {
    if (seen.has(model.id)) {
      return false
    }
    seen.add(model.id)
    return true
  })
}

function buildModelOptions(input: {
  models: ModelDescriptor[]
  aliases: ClaudeAgentModelAliases
  mainModelId: string | null
}): Array<{ id: string, label: string }> {
  const aliasModels = CLAUDE_AGENT_ALIAS_KEYS
    .map(key => input.aliases[key].trim())
    .filter(Boolean)
    .map(id => ({ id, label: id }))

  const mainModel = input.mainModelId
    ? [{ id: input.mainModelId, label: input.mainModelId }]
    : []

  return dedupeModelOptions([
    ...mainModel,
    ...input.models.map(model => ({ id: model.id, label: modelLabel(model) })),
    ...aliasModels,
  ])
}

export function ClaudeModelMatrixEditor({
  aliases,
  models,
  mainModelId,
  loading = false,
  onChange,
}: {
  aliases: ClaudeAgentModelAliases
  models: ModelDescriptor[]
  mainModelId: string | null
  loading?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
}) {
  const modelOptions = buildModelOptions({ models, aliases, mainModelId })
  const canSetAllToCurrent = !!mainModelId

  const setAlias = (key: ClaudeAgentAliasKey, value: string) => {
    onChange({
      ...aliases,
      [key]: value === CURRENT_MODEL_VALUE ? '' : value,
    })
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h5 className="font-heading text-[13px] font-medium text-foreground">
            Model routing matrix
          </h5>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Map each Claude tier to a concrete model.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {loading && <Spinner className="size-3 text-muted-foreground" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!canSetAllToCurrent}
                onClick={() => {
                  if (!mainModelId) {
                    return
                  }
                  onChange({
                    haiku: mainModelId,
                    sonnet: mainModelId,
                    opus: mainModelId,
                  })
                }}
                className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                Pin all
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Route every tier to the current model
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_CLAUDE_AGENT_ALIASES)}
                className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Reset
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Clear all overrides
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/8">
        {TIERS.map((tier, index) => {
          const Glyph = tier.glyph
          const currentValue = aliases[tier.key] || CURRENT_MODEL_VALUE
          const isPassthrough = currentValue === CURRENT_MODEL_VALUE
          const activeModel = modelOptions.find(m => m.id === currentValue)

          return (
            <div key={tier.key}>
              {index > 0 && <SettingsDivider />}
              <div className="relative flex gap-3 px-3 py-2.5">
                <div className={cn('absolute inset-y-0 left-0 w-0.5', tier.accent.bar)} aria-hidden="true" />

                <div className="flex w-[5.5rem] shrink-0 flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('flex size-5 items-center justify-center rounded-md', tier.accent.chip)}>
                      <Glyph className="size-3" aria-hidden="true" />
                    </span>
                    <span className="text-[12px] font-medium text-foreground">{tier.label}</span>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground/80">{tier.description}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-flex h-4 items-center gap-1 rounded px-1.5 font-mono text-[10px] font-medium',
                        isPassthrough
                          ? 'bg-muted text-muted-foreground'
                          : cn(tier.accent.chipActive, 'font-mono'),
                      )}
                    >
                      {isPassthrough
                        ? (
                            <>
                              <PassthroughIcon className="size-2.5" aria-hidden="true" />
                              passthrough
                            </>
                          )
                        : (activeModel?.label ?? currentValue)}
                    </span>
                  </div>

                  <div
                    className={cn(
                      'flex items-center gap-1 overflow-x-auto rounded-md px-1.5 py-1',
                      tier.accent.rail,
                    )}
                  >
                    <TierChip
                      active={isPassthrough}
                      onClick={() => setAlias(tier.key, CURRENT_MODEL_VALUE)}
                      tierAccentClass={tier.accent.chipActive}
                      title="Use current model"
                    >
                      <PassthroughIcon className="size-2.5" aria-hidden="true" />
                      <span>current</span>
                    </TierChip>

                    {modelOptions.map(model => {
                      const active = model.id === currentValue
                      return (
                        <TierChip
                          key={model.id}
                          active={active}
                          onClick={() => setAlias(tier.key, model.id)}
                          tierAccentClass={tier.accent.chipActive}
                          title={model.id}
                        >
                          <span className="truncate">{model.label}</span>
                        </TierChip>
                      )
                    })}

                    {modelOptions.length === 0 && (
                      <span className="px-1.5 text-[10.5px] text-muted-foreground/60">
                        No models discovered yet.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TierChip({
  active,
  onClick,
  tierAccentClass,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  tierAccentClass: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-6 shrink-0 max-w-[10rem] items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
        active
          ? tierAccentClass
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
