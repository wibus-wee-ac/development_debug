import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { useAgentModels } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { type JarvisPreferences, useJarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

const THINKING_LEVELS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
] as const

export function JarvisSettings() {
  const { prefs, isSaving: saving, savePrefs: save } = useJarvisPreferences()
  const { profiles } = useAgentProfiles()
  const { models, isLoading: isLoadingModels } = useAgentModels(prefs?.profileId ?? null)

  if (!prefs) return null

  return (
    <div className="flex flex-col gap-0">
      <SettingsSectionHeader
        title="Jarvis"
        description="Configure the system assistant that has full awareness of your workspace."
      />
      <SettingsDivider />

      <SettingsRow label="Agent Profile" description="Which configured agent profile Jarvis should use">
        <Select
          value={prefs.profileId ?? '__none__'}
          onValueChange={v => void save({ profileId: v === '__none__' ? null : v })}
          disabled={saving}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select a profile..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not configured</SelectItem>
            {profiles.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow label="Model" description="Which model Jarvis should use from the selected profile">
        <Select
          value={prefs.model ?? '__none__'}
          onValueChange={v => void save({ model: v === '__none__' ? undefined : v })}
          disabled={saving || isLoadingModels || !prefs.profileId}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={isLoadingModels ? 'Loading…' : 'Select a model…'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Auto (profile default)</SelectItem>
            {models.map(m => (
              <SelectItem key={m.id} value={m.id}>{m.label ?? m.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow label="Thinking Level" description="How much reasoning budget to allocate">
        <Select
          value={prefs.thinkingLevel}
          onValueChange={v => void save({ thinkingLevel: v as JarvisPreferences['thinkingLevel'] })}
          disabled={saving}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THINKING_LEVELS.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )
}
