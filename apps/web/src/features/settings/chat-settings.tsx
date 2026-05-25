// Chat settings for default continuation behavior.
import { useTranslation } from 'react-i18next'

import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'
import type { ApprovalMode, ContinuationBehavior } from './use-chat-preferences'
import { useChatPreferences } from './use-chat-preferences'

export function ChatSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isSaving, savePrefs } = useChatPreferences()

  if (!prefs) {
    return null
  }

  const handleBehaviorChange = (value: string) => {
    if (value !== 'queue' && value !== 'steer') {
      return
    }
    void savePrefs({ continuationBehavior: value as ContinuationBehavior })
  }

  const handleApprovalModeChange = (checked: boolean) => {
    const approvalMode: ApprovalMode = checked ? 'allowAll' : 'ask'
    void savePrefs({ approvalMode })
  }

  return (
    <div className="flex flex-col gap-0" data-testid="chat-settings">
      <SettingsSectionHeader
        title={t('chat.page.title')}
        description={t('chat.page.description')}
      />
      <SettingsDivider />

      <SettingsRow
        label={t('chat.continuation.label')}
        description={t('chat.continuation.description')}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={prefs.continuationBehavior}
          onValueChange={handleBehaviorChange}
          disabled={isSaving}
          aria-label={t('chat.continuation.label')}
          data-testid="chat-continuation-behavior"
        >
          <ToggleGroupItem value="queue" aria-label={t('chat.continuation.queue')}>
            {t('chat.continuation.queue')}
          </ToggleGroupItem>
          <ToggleGroupItem value="steer" aria-label={t('chat.continuation.steer')}>
            {t('chat.continuation.steer')}
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingsRow>

      <SettingsDivider />

      <SettingsRow
        label={t('chat.approval.label')}
        description={t('chat.approval.description')}
      >
        <Switch
          size="sm"
          checked={prefs.approvalMode === 'allowAll'}
          onCheckedChange={handleApprovalModeChange}
          disabled={isSaving}
          aria-label={t('chat.approval.label')}
          data-testid="chat-approval-mode"
        />
      </SettingsRow>
    </div>
  )
}
