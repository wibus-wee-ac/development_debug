/**
 * Output: Workspace overview chat launcher backed by the shared chat Composer behavior.
 * Input: Workspace id, composer runtime/profile selection, workspace file inventory, and send callback.
 * Position: Workspace detail owns the launcher semantics; chat owns composer input behavior.
 */

import type { FileUIPart } from 'ai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MentionItem } from '~/features/chat'
import { getFallbackRuntimeSlashCommands } from '~/features/chat/chat-slash-commands'
import { Composer } from '~/features/chat/composer'
import { modelSupportsAttachments } from '~/features/chat/composer-attachment-state'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'
import type { RuntimeKind } from '~/lib/types'

interface CapsuleComposerProps {
  workspaceId: string
  onSend: (
    text: string,
    files: FileUIPart[],
    opts: {
      runtimeKind: RuntimeKind
      agentId?: string
      providerTargetId?: string
      modelId?: string
      thinkingEffort?: 'low' | 'medium' | 'high'
    },
  ) => void | Promise<void>
}

export function CapsuleComposer({ workspaceId, onSend }: CapsuleComposerProps) {
  const { t } = useTranslation('workspace')
  const composerState = useComposerState({ context: 'capsule' })
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState
  const [sending, setSending] = useState(false)

  const supportsAttachments = useMemo(() => modelSupportsAttachments(effectiveModel), [effectiveModel])
  const slashCommands = useMemo(
    () => getFallbackRuntimeSlashCommands(selection.runtimeKind),
    [selection.runtimeKind],
  )
  const searchFiles = useCallback(async (query: string): Promise<MentionItem[]> => {
    return searchWorkspaceFiles({ workspaceId, query, limit: 30 })
  }, [workspaceId])
  const sendDisabled = selection.runtimeKind === 'cli-tui'
    ? !effectiveAgent || sending
    : !effectiveProfile || sending

  const handleSend = useCallback(async (text: string, files: FileUIPart[]) => {
    if (selection.runtimeKind === 'cli-tui') {
      if (!effectiveAgent) {
        return false
      }
    }
    else if ((!text.trim() && files.length === 0) || !effectiveProfile) {
      return false
    }

    setSending(true)
    try {
      await onSend(text.trim(), files, {
        runtimeKind: selection.runtimeKind,
        ...(selection.runtimeKind === 'cli-tui'
          ? { agentId: effectiveAgent?.id }
          : {
              providerTargetId: effectiveProfile?.id,
              modelId: effectiveModel?.id,
              thinkingEffort: selection.thinkingEffort ?? undefined,
            }),
      })
      return true
    }
    finally {
      setSending(false)
    }
  }, [effectiveAgent, effectiveModel, effectiveProfile, onSend, selection.runtimeKind, selection.thinkingEffort])

  return (
    <Composer
      send={{
        submit: handleSend,
        isSending: sending,
        sendDisabled,
        allowEmptySend: selection.runtimeKind === 'cli-tui',
      }}
      commands={{
        commands: slashCommands,
      }}
      attachments={{
        supportsAttachments,
      }}
      slots={{
        toolbar: <ComposerToolbar context="capsule" state={composerState} />,
      }}
      view={{
        placeholder: t('capsule.placeholder'),
        searchFiles,
        cardClassName: cn(
          'overflow-hidden border-border bg-background/70 backdrop-blur-xl shadow-sm',
          'rounded-[22px] focus-within:rounded-2xl focus-within:shadow-lg',
          'transition-[border-color,border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        ),
        textareaRows: 1,
        textareaClassName: 'min-h-11 max-h-60 px-5 py-3 text-sm placeholder:text-muted-foreground/40 focus:min-h-16 focus:px-4 focus:pt-3.5 focus:pb-2',
        attachmentListClassName: 'px-3 py-2',
        actionBarClassName: 'border-t border-border/20 px-3 py-2',
        attachIconClassName: 'size-3',
      }}
      accessibility={{
        textareaAriaLabel: t('capsule.aria.message'),
        sendButtonAriaLabel: t('capsule.aria.send'),
      }}
      testIds={{
        actionTarget: 'workspace-detail-capsule-action-target',
        textarea: 'workspace-detail-capsule-textarea',
        fileInput: 'workspace-detail-capsule-file-input',
        attachButton: 'workspace-detail-capsule-attach-btn',
        sendButton: 'workspace-detail-capsule-send-btn',
      }}
    />
  )
}
