import type { FileUIPart } from 'ai'
import { SettingsIcon } from 'lucide-react'
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSkills } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import type { SkillInventoryEntry } from '~/features/skills/types'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import { useNewChatStore } from '~/store/new-chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useCradleTabStore } from '~/tabs/registry'

import type { ChatContextPart } from './chat-context-parts'
import type { ChatRuntimeSettings } from './chat-response-command'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { CODEX_REVIEW_SLASH_ACTION_ID } from './chat-slash-commands'
import { Composer } from './composer'
import type { ComposerSlashCommandActionResult } from './composer-action-context'
import { modelSupportsAttachments } from './composer-attachment-state'
import { ComposerSlotStates } from './composer-slot-states'
import type { MentionItem } from './mention-panel'
import { searchPluginMentions } from './plugin-mentions'
import { DEFAULT_CHAT_RUNTIME_SETTINGS } from './runtime-settings-command'
import { RuntimeSettingsControl } from './runtime-settings-control'
import type { SkillMentionItem } from './skill-mention-panel'
import { useRuntimeComposerSlashCommands } from './use-runtime-composer-slash-commands'

type ChatThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh'

const PLACEHOLDER_HINT_KEYS = [
  'placeholder.task',
  'placeholder.structure',
  'placeholder.risk',
  'placeholder.fixTest',
  'placeholder.refactor',
] as const

export interface DraftChatComposerSubmitOptions {
  runtimeKind: RuntimeKind
  agentId?: string
  agentName?: string
  providerTargetId?: string
  providerTargetName?: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings: ChatRuntimeSettings
}

export type DraftChatComposerSendHandler = (
  text: string,
  files: FileUIPart[],
  contextParts: ChatContextPart[],
  options: DraftChatComposerSubmitOptions,
) => boolean | void | Promise<boolean | void>

interface DraftChatComposerProps {
  workspaceId: string | null
  active?: boolean
  contextBar?: ReactNode
  replaceText?: string
  replaceTextKey?: number
  onDraftChange?: (draft: string) => void
  onSend: DraftChatComposerSendHandler
  onSendInNewWindow?: DraftChatComposerSendHandler
  testIdPrefix?: string
}

function useRotatingPlaceholder(hints: string[], active: boolean, interval = 4000): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => {
      setIndex(i => (i + 1) % hints.length)
    }, interval)
    return () => clearInterval(timer)
  }, [active, hints.length, interval])

  return hints[index]
}

export function DraftChatComposer({
  workspaceId,
  active = true,
  contextBar,
  replaceText,
  replaceTextKey,
  onDraftChange,
  onSend,
  onSendInNewWindow,
  testIdPrefix = 'draft-chat',
}: DraftChatComposerProps) {
  const { t } = useTranslation('new-chat')
  const composerState = useComposerState({ context: 'new-chat' })
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState
  const runtimeSettings = useNewChatStore(s => s.lastRuntimeSettings ?? DEFAULT_CHAT_RUNTIME_SETTINGS)
  const setRuntimeSettings = useNewChatStore(s => s.setLastRuntimeSettings)
  const [sending, setSending] = useState(false)
  const [reviewModeOpen, setReviewModeOpen] = useState(false)
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)

  const placeholderHints = useMemo(() => PLACEHOLDER_HINT_KEYS.map(key => t(key)), [t])
  const placeholder = useRotatingPlaceholder(placeholderHints, active)
  const supportsAttachments = useMemo(() => modelSupportsAttachments(effectiveModel), [effectiveModel])
  const slashCommands = useRuntimeComposerSlashCommands(selection.runtimeKind)
  const sendDisabled = selection.runtimeKind === 'cli-tui'
    ? !effectiveAgent || sending
    : !effectiveProfile || sending

  const readinessNotice = useMemo(() => {
    if (
      composerState.isLoadingAgents
      || composerState.isLoadingProfiles
      || composerState.isLoadingModels
    ) {
      return null
    }
    if (selection.runtimeKind === 'cli-tui' && !effectiveAgent) {
      return {
        key: 'agents',
        icon: SettingsIcon,
        message: t('readiness.agent.message'),
        actionLabel: t('readiness.agent.action'),
        disabled: false,
      }
    }
    if (selection.runtimeKind !== 'cli-tui' && !effectiveProfile) {
      return {
        key: 'providers',
        icon: SettingsIcon,
        message: t('readiness.provider.message'),
        actionLabel: t('readiness.provider.action'),
        disabled: false,
      }
    }
    return null
  }, [
    composerState.isLoadingAgents,
    composerState.isLoadingModels,
    composerState.isLoadingProfiles,
    effectiveAgent,
    effectiveProfile,
    selection.runtimeKind,
    t,
  ])

  const searchFiles = useCallback(async (query: string, signal?: AbortSignal): Promise<MentionItem[]> => {
    if (!workspaceId) {
      return []
    }
    return searchWorkspaceFiles({ workspaceId, query, limit: 30, signal })
  }, [workspaceId])

  const searchSkills = useCallback(async (_query: string, signal?: AbortSignal): Promise<SkillMentionItem[]> => {
    const { data } = await getSkills({
      query: {
        workspaceId: workspaceId ?? undefined,
        agentId: effectiveAgent?.id ?? undefined,
      },
      signal,
    })
    const activeSkills: SkillMentionItem[] = []
    for (const skill of (data ?? []) as SkillInventoryEntry[]) {
      if (!skill.active) {
        continue
      }
      activeSkills.push({
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        skillDir: skill.skillDir,
      })
    }
    return activeSkills
  }, [effectiveAgent?.id, workspaceId])

  const openSettingsSection = useCallback((section: string) => {
    const tabStore = useCradleTabStore.getState()
    const activeTabId = tabStore.activeTabId && tabStore.tabs.some(tab => tab.id === tabStore.activeTabId)
      ? tabStore.activeTabId
      : tabStore.tabs[0]?.id
    if (!activeTabId) {
      return
    }
    setSettingsSection(section)
    openSettings(activeTabId)
  }, [openSettings, setSettingsSection])

  const updateRuntimeSettings = useCallback((patch: Partial<ChatRuntimeSettings>) => {
    setRuntimeSettings({
      ...runtimeSettings,
      ...patch,
    })
  }, [runtimeSettings, setRuntimeSettings])

  const toolbar = useMemo(() => (
    <div className="flex min-w-0 items-center gap-1">
      <RuntimeSettingsControl
        settings={runtimeSettings}
        applied
        disabled={sending}
        onChange={updateRuntimeSettings}
      />
      <ComposerToolbar context="new-chat" state={composerState} />
    </div>
  ), [composerState, runtimeSettings, sending, updateRuntimeSettings])

  const handleSendWithTarget = useCallback(async (
    sendTarget: DraftChatComposerSendHandler,
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
  ) => {
    const trimmedText = text.trim()
    const hasDraft = trimmedText.length > 0 || files.length > 0 || contextParts.length > 0
    const canSubmit = selection.runtimeKind === 'cli-tui'
      ? !!effectiveAgent && !sending
      : !!effectiveProfile && hasDraft && !sending

    if (!canSubmit) {
      return false
    }

    setSending(true)
    try {
      await sendTarget(trimmedText, files, contextParts, {
        runtimeKind: selection.runtimeKind,
        ...(selection.runtimeKind === 'cli-tui'
          ? {
              agentId: effectiveAgent?.id,
              agentName: effectiveAgent?.name,
            }
          : {
              providerTargetId: effectiveProfile?.id,
              providerTargetName: effectiveProfile?.name,
              modelId: selection.modelId ?? effectiveModel?.id,
              thinkingEffort: selection.thinkingEffort ?? undefined,
            }),
        runtimeSettings,
      })
      return true
    }
    finally {
      setSending(false)
    }
  }, [effectiveAgent, effectiveModel, effectiveProfile, runtimeSettings, selection.modelId, selection.runtimeKind, selection.thinkingEffort, sending])

  const handleSend = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[]) => {
    return handleSendWithTarget(onSend, text, files, contextParts)
  }, [handleSendWithTarget, onSend])

  const handleSendInNewWindow = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[]) => {
    return onSendInNewWindow
      ? handleSendWithTarget(onSendInNewWindow, text, files, contextParts)
      : handleSend(text, files, contextParts)
  }, [handleSend, handleSendWithTarget, onSendInNewWindow])

  const handleSlashCommandAction = useCallback((command: ChatComposerSlashCommand): ComposerSlashCommandActionResult | void => {
    if (command.action.kind !== 'uiAction' || command.action.actionId !== CODEX_REVIEW_SLASH_ACTION_ID) {
      return
    }
    setReviewModeOpen(true)
    return { insertText: '' }
  }, [])

  const submitCodexReviewPrompt = useCallback((prompt: string) => {
    void handleSend(prompt, [], [])
  }, [handleSend])

  const resolveCodexReviewMergeBase = useCallback(async (baseBranch: string) => {
    if (!workspaceId) {
      return null
    }
    const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/git/merge-base`, getServerUrl())
    url.searchParams.set('baseBranch', baseBranch)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to resolve merge base (${response.status}).`)
    }
    const payload = await response.json() as { mergeBaseSha?: unknown }
    return typeof payload.mergeBaseSha === 'string' ? payload.mergeBaseSha : null
  }, [workspaceId])

  const reviewSlot = useMemo(() => ({
    open: reviewModeOpen,
    workspaceId,
    onDismiss: () => setReviewModeOpen(false),
    onSubmitPrompt: submitCodexReviewPrompt,
    resolveMergeBase: resolveCodexReviewMergeBase,
  }), [resolveCodexReviewMergeBase, reviewModeOpen, submitCodexReviewPrompt, workspaceId])

  return (
    <>
      <ComposerSlotStates
        slots={[]}
        states={[]}
        review={reviewSlot}
      />
      <Composer
        send={{
          submit: handleSend,
          submitInNewWindow: handleSendInNewWindow,
          isSending: sending,
          sendDisabled,
          allowEmptySend: selection.runtimeKind === 'cli-tui',
        }}
        commands={{
          commands: slashCommands,
          runAction: handleSlashCommandAction,
        }}
        attachments={{
          supportsAttachments,
        }}
        runtimeSettings={{
          settings: runtimeSettings,
          disabled: sending,
          onChange: updateRuntimeSettings,
        }}
        slots={{
          toolbar,
          contextBar,
        }}
        externalSignals={{
          replaceText,
          replaceTextKey,
        }}
        view={{
          placeholder,
          searchFiles,
          searchPlugins: searchPluginMentions,
          searchSkills,
          onDraftChange,
          className: 'relative',
          cardClassName: cn(
            'overflow-hidden rounded-2xl',
            'border-border/60 bg-background shadow-none',
            'ring-1 ring-inset ring-white/[0.02] dark:ring-white/[0.04]',
            'transition-[border-color,box-shadow] duration-200',
            'focus-within:border-ring/50 focus-within:shadow-[var(--shadow-xs)]',
          ),
          textareaRows: 5,
          textareaClassName: 'px-5 pt-5 pb-3 text-[15px] leading-[1.75] placeholder:text-muted-foreground/30 min-h-30 max-h-80 rounded-t-2xl disabled:opacity-30',
          attachmentListClassName: 'border-border/60 px-3 py-2',
          actionBarClassName: 'border-t border-border/60 px-2.5 py-2',
          attachButtonClassName: 'text-muted-foreground/30',
          attachIconClassName: 'size-3',
          sendButtonClassName: 'ml-0.5',
        }}
        accessibility={{
          textareaAriaLabel: t('accessibility.message', 'New chat message'),
          sendButtonAriaLabel: t('send.tooltip'),
        }}
        testIds={{
          actionTarget: `${testIdPrefix}-composer-action-target`,
          textarea: `${testIdPrefix}-textarea`,
          fileInput: `${testIdPrefix}-file-input`,
          attachButton: `${testIdPrefix}-attach-btn`,
          sendButton: `${testIdPrefix}-send-btn`,
        }}
      />
      <DraftChatReadinessNotice
        notice={readinessNotice}
        onAction={openSettingsSection}
        testIdPrefix={testIdPrefix}
      />
    </>
  )
}

function DraftChatReadinessNotice({
  notice,
  onAction,
  testIdPrefix,
}: {
  notice: {
    key: string
    icon: typeof SettingsIcon
    message: string
    actionLabel: string
    disabled: boolean
  } | null
  onAction: (section: string) => void
  testIdPrefix: string
}) {
  if (!notice) {
    return null
  }

  const NoticeIcon = notice.icon

  return (
    <m.div
      className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid={`${testIdPrefix}-readiness-notice`}
    >
      <NoticeIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-relaxed">{notice.message}</span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onAction(notice.key)}
        disabled={notice.disabled}
        className="h-7 shrink-0"
      >
        {notice.actionLabel}
      </Button>
    </m.div>
  )
}
