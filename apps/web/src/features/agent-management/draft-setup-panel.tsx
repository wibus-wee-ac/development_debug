import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { postSecrets } from '~/api-gen/sdk.gen'
import { PROVIDER_ICONS } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { warmManualProviderModelCache } from './provider-model-cache'
import type { DraftProvider } from './provider-settings-utils'
import { buildProfileId } from './provider-settings-utils'
import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

interface PresetSetupFormValues {
  name: string
  values: Record<string, string>
}

const SecretCreateResponseSchema = z.object({
  id: z.string().min(1),
})

export function DraftSetupPanel({
  draft,
  onSelectPreset,
  onComplete,
  onCancel,
}: {
  draft: DraftProvider
  onSelectPreset: (presetId: string) => void
  onComplete: (newProfileId?: string) => void
  onCancel: () => void
}) {
  const preset = PROVIDER_PRESETS.find(p => p.id === draft.presetId) ?? null

  if (!preset) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-heading text-[14px] font-medium text-foreground">
              Choose a provider
            </h4>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Cradle works with the major coding agents and any OpenAI-compatible endpoint.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <XIcon />
            Cancel
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PROVIDER_PRESETS.map((p, idx) => {
            const Icon = PROVIDER_ICONS[p.id] ?? PROVIDER_ICONS.custom!
            return (
              <m.button
                key={p.id}
                type="button"
                onClick={() => onSelectPreset(p.id)}
                data-testid={`provider-preset-${p.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.03, ease: 'easeOut' }}
                whileHover={{ y: -1 }}
                className={cn(
                  'group/preset relative flex flex-col gap-2 rounded-xl bg-card p-3.5 text-left',
                  'ring-1 ring-foreground/[0.07] transition-[box-shadow,ring-color] duration-150',
                  'hover:ring-foreground/15 hover:shadow-sm',
                  'active:scale-[0.97]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="size-5 shrink-0 text-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">{p.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{p.tagline}</div>
                  </div>
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/30 transition-[transform,color] duration-150 group-hover/preset:translate-x-0.5 group-hover/preset:text-muted-foreground" />
                </div>
                <p className="text-pretty text-[11.5px] leading-relaxed text-muted-foreground/80">
                  {p.tagline}
                </p>
              </m.button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <PresetSetupForm preset={preset} onComplete={onComplete} onBack={() => onSelectPreset('')} />
  )
}

function PresetSetupForm({
  preset,
  onComplete,
  onBack,
}: {
  preset: ProviderPreset
  onComplete: (newProfileId?: string) => void
  onBack: () => void
}) {
  const Icon = PROVIDER_ICONS[preset.id] ?? PROVIDER_ICONS.custom!
  const { createProfile } = useAgentProfiles()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean, text: string } | null>(null)

  const form = useForm<PresetSetupFormValues>({
    defaultValues: {
      name: preset.name,
      values: {},
    },
  })
  const watchedValues = useWatch({ control: form.control }) as PresetSetupFormValues
  const name = watchedValues.name ?? ''
  const values = watchedValues.values ?? {}
  const profileId = useMemo(() => buildProfileId(name, preset.id), [name, preset.id])
  const canSubmit = name.trim().length > 0

  useEffect(() => {
    form.reset({ name: preset.name, values: {} })
    setStatus(null)
  }, [form, preset])

  const handleConnect = useCallback(async () => {
    const currentValues = form.getValues()
    setStatus(null)

    const requiresApiKey = preset.fields.some(f => f.key === 'apiKey')
    if (requiresApiKey && !currentValues.values.apiKey) {
      setStatus({ ok: false, text: 'API key secretRef is required' })
      return
    }

    setBusy(true)
    try {
      let credentialRef: string | null = null
      const apiKey = currentValues.values.apiKey
      if (apiKey) {
        const { data: meta } = await postSecrets({
          body: { kind: preset.providerKind, label: currentValues.name, secret: apiKey },
        })
        credentialRef = SecretCreateResponseSchema.parse(meta).id
      }

      const config: Record<string, unknown> = { ...preset.defaults }
      if (currentValues.values.baseUrl) {
        config.baseUrl = currentValues.values.baseUrl
      }
      if (currentValues.values.model) {
        config.model = currentValues.values.model
      }

      await createProfile.mutateAsync({
        path: { id: profileId },
        body: {
          name: currentValues.name,
          providerKind: preset.providerKind,
          enabled: true,
          config,
          credentialRef,
        },
      })

      void warmManualProviderModelCache({
        id: profileId,
        name: currentValues.name,
        providerKind: preset.providerKind,
        config,
        credentialRef,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }))
        .catch(error => console.error('[ProviderSetup] model cache warm failed', error))
      setStatus({ ok: true, text: 'Saved' })
      setTimeout(onComplete, 500, profileId)
    }
 catch (err) {
      setStatus({ ok: false, text: 'Failed to save provider' })
      console.error('[ProviderSetup]', err)
    }
 finally {
      setBusy(false)
    }
  }, [createProfile, form, onComplete, preset, profileId, queryClient])

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3" />
          Templates
        </button>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground">{preset.name}</span>
      </div>

      {/* Hero */}
      <div className="flex items-start gap-3">
        <Icon className="size-6 shrink-0 text-foreground/80 mt-0.5" />
        <div className="flex-1 pt-0.5">
          <h4 className="font-heading text-[15px] font-medium text-foreground">{preset.name}</h4>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{preset.tagline}</p>
        </div>
      </div>

      <Separator className="bg-foreground/6" />

      {/* Form */}
      <div className="flex flex-col">
        <SettingsRow
          label="Display name"
          description="This is how the provider shows up in chat and agent settings."
        >
          <Input
            data-testid="provider-name"
            {...form.register('name')}
            placeholder={preset.name}
            className="h-9 w-56 text-[13px]"
          />
        </SettingsRow>

        {preset.fields.map((field) => {
          const isApiKey = field.key === 'apiKey'
          const isBaseUrl = field.key === 'baseUrl'
          const testId = isBaseUrl
            ? 'provider-baseurl'
            : isApiKey
              ? 'provider-apikey'
              : `provider-field-${field.key}`
          return (
            <div key={field.key}>
              <SettingsDivider />
              <SettingsRow
                label={field.label}
                description={
                  isApiKey
                    ? 'Stored locally and encrypted. Never sent to Cradle servers.'
                    : undefined
                }
              >
                <Input
                  data-testid={testId}
                  type={field.type === 'password' ? 'password' : 'text'}
                  value={values[field.key] ?? ''}
                  onChange={e =>
                    form.setValue(`values.${field.key}`, e.target.value, { shouldDirty: true })}
                  placeholder={field.placeholder}
                  className={cn('h-9 w-56 text-[13px]', field.mono && 'font-mono')}
                />
              </SettingsRow>
            </div>
          )
        })}

        {preset.fields.length === 0 && (
          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground ring-1 ring-foreground/4 mt-2">
            No credentials needed: this provider runs on your machine.
          </div>
        )}
      </div>

      {/* Status */}
      <AnimatePresence>
        {status && (
          <m.div
            data-testid="provider-status"
            data-status-ok={status.ok ? 'true' : 'false'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ring-1',
              status.ok
                ? 'bg-emerald-500/8 text-emerald-600 ring-emerald-500/15 dark:text-emerald-400'
                : 'bg-destructive/8 text-destructive ring-destructive/15',
            )}
          >
            {status.ok
? (
              <CircleCheckIcon className="size-3.5" />
            )
: (
              <CircleAlertIcon className="size-3.5" />
            )}
            {status.text}
          </m.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          data-testid="provider-submit"
          size="sm"
          onClick={() => void handleConnect()}
          disabled={busy || !canSubmit}
        >
          {busy ? <Spinner className="size-3" /> : <CheckIcon />}
          {busy ? 'Saving...' : 'Save provider'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  )
}
