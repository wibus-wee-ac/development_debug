// Chat settings for default continuation behavior.
import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'
import type { ApprovalMode, ContinuationBehavior } from './use-chat-preferences'
import { useChatPreferences } from './use-chat-preferences'

export function ChatSettings() {
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
        title="对话"
        description="配置对话与代理会话的默认行为。"
      />
      <SettingsDivider />

      <SettingsRow
        label="跟进行为"
        description="在 Cradle 运行时将后续操作加入队列，或引导当前运行。按下“⇧⌘⏎”可对单条消息执行相反操作"
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={prefs.continuationBehavior}
          onValueChange={handleBehaviorChange}
          disabled={isSaving}
          aria-label="Continuation behavior"
          data-testid="chat-continuation-behavior"
        >
          <ToggleGroupItem value="queue" aria-label="排队">
            排队
          </ToggleGroupItem>
          <ToggleGroupItem value="steer" aria-label="引导">
            引导
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingsRow>

      <SettingsDivider />

      <SettingsRow
        label="自动允许工具请求"
        description="跳过 Cradle 的工具审批弹窗，并对每次请求直接返回允许；不会写入 Always Allow 规则，也不会切换底层运行时权限模式。"
      >
        <Switch
          size="sm"
          checked={prefs.approvalMode === 'allowAll'}
          onCheckedChange={handleApprovalModeChange}
          disabled={isSaving}
          aria-label="自动允许工具请求"
          data-testid="chat-approval-mode"
        />
      </SettingsRow>
    </div>
  )
}
