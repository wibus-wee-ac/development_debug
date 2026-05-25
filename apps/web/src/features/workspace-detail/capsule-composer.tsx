import type { FileUIPart } from 'ai'
import {
  Loader2Icon,
  SendHorizonalIcon,
} from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import type { MentionItem } from '~/features/chat'
import type { ChatComposerSlashCommand } from '~/features/chat/chat-slash-commands'
import { getFallbackRuntimeSlashCommands } from '~/features/chat/chat-slash-commands'
import { modelSupportsAttachments, useComposerAttachments } from '~/features/chat/composer-attachment-state'
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
} from '~/features/chat/composer-attachments'
import { MentionPanel } from '~/features/chat/mention-panel'
import { getSlashCommandPanelItems, SlashCommandPanel } from '~/features/chat/slash-command-panel'
import {
  getActiveSlashCommand,
  readSlashTriggerState,
  replaceSlashTrigger,
} from '~/features/chat/slash-command-input'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'

interface CapsuleComposerProps {
  workspaceId: string
  onSend: (text: string, files: FileUIPart[], opts: { runtimeKind: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui', agentId?: string, providerTargetId?: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' }) => void | Promise<void>
}

function useCapsuleComposerOwner({ workspaceId, onSend }: CapsuleComposerProps) {
  const composerState = useComposerState({ context: 'capsule' })
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState

  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [slashActive, setSlashActive] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<ChatComposerSlashCommand | null>(null)
  const [activeSlashOptionId, setActiveSlashOptionId] = useState<string | undefined>(undefined)
  const supportsAttachments = useMemo(() => modelSupportsAttachments(effectiveModel), [effectiveModel])
  const attachmentController = useComposerAttachments({ supportsAttachments })
  const mentionStartRef = useRef<number>(-1)
  const slashStartRef = useRef<number>(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const slashCommands = useMemo(
    () => getFallbackRuntimeSlashCommands(selection.runtimeKind),
    [selection.runtimeKind],
  )
  const slashPanelItems = useMemo(
    () => getSlashCommandPanelItems(slashCommands, slashQuery),
    [slashCommands, slashQuery],
  )
  const slashPanelHasResults = slashActive && slashPanelItems.length > 0

  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)
  const availableFiles: MentionItem[] = useMemo(
    () => workspaceFiles.map(file => ({ type: file.type, name: file.name, path: file.path })),
    [workspaceFiles],
  )

  useEffect(() => {
    if (!expanded) {
      return
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [expanded])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    if (expanded) {
      el.style.height = '0'
      const height = Math.min(el.scrollHeight, 240)
      el.style.height = `${height}px`
    }
    else {
      el.style.height = ''
    }
  }, [expanded])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    autoResize()
    const cursor = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)
    const slashTrigger = readSlashTriggerState(value, cursor, slashCommands, selectedSlashCommand)

    if (slashTrigger) {
      mentionStartRef.current = -1
      slashStartRef.current = slashTrigger.start
      setMentionActive(false)
      setMentionQuery('')
      setSlashActive(true)
      setSlashQuery(slashTrigger.query)
      setSelectedSlashCommand(slashTrigger.selectedCommand)
      return
    }

    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const afterAt = textBefore.slice(atIdx + 1)
      if (!afterAt.includes('\n')) {
        setMentionActive(true)
        setMentionQuery(afterAt)
        mentionStartRef.current = atIdx
        slashStartRef.current = -1
        setSlashActive(false)
        setSlashQuery('')
        return
      }
    }
    setMentionActive(false)
    setMentionQuery('')
    slashStartRef.current = -1
    setSlashActive(false)
    setSlashQuery('')
    setSelectedSlashCommand(getActiveSlashCommand(value, selectedSlashCommand, slashCommands))
  }, [autoResize, selectedSlashCommand, slashCommands])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const start = mentionStartRef.current
    if (start < 0) {
      return
    }
    const before = input.slice(0, start)
    const cursor = textareaRef.current?.selectionStart ?? input.length
    const after = input.slice(cursor)
    const suffix = item.type === 'directory' ? '/' : ' '
    const insertText = `@${item.path}${suffix}`
    const newValue = `${before}${insertText}${after}`
    setInput(newValue)

    if (item.type === 'directory') {
      setMentionActive(true)
      setMentionQuery(`${item.path}/`)
      mentionStartRef.current = start
    }
    else {
      setMentionActive(false)
      mentionStartRef.current = -1
    }

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const pos = before.length + insertText.length
        el.setSelectionRange(pos, pos)
        autoResize()
      }
    })
  }, [autoResize, input])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (selection.runtimeKind === 'cli-tui') {
      if (!effectiveAgent) {
        return
      }
    }
    else if ((!text && !attachmentController.hasAttachments) || !effectiveProfile) {
      return
    }
    setSending(true)
    try {
      await onSend(text, attachmentController.attachments, {
        runtimeKind: selection.runtimeKind,
        ...(selection.runtimeKind === 'cli-tui'
          ? { agentId: effectiveAgent?.id }
          : {
              providerTargetId: effectiveProfile?.id,
              modelId: effectiveModel?.id,
              thinkingEffort: selection.thinkingEffort ?? undefined,
            }),
      })
      attachmentController.clearAttachments()
      setInput('')
      setExpanded(false)
      setMentionActive(false)
      setSlashActive(false)
      setSlashQuery('')
      setSelectedSlashCommand(null)
    }
    finally {
      setSending(false)
    }
  }, [attachmentController, onSend, effectiveAgent, effectiveProfile, effectiveModel, selection.runtimeKind, selection.thinkingEffort, input])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return
    }
    if ((mentionActive || (slashActive && slashPanelHasResults)) && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
    if (e.key === 'Escape') {
      setExpanded(false)
      textareaRef.current?.blur()
    }
  }, [handleSend, mentionActive, slashActive, slashPanelHasResults])

  const handleSlashCommandSelect = useCallback((command: ChatComposerSlashCommand) => {
    if (command.action.kind !== 'insertText') {
      return
    }
    const cursor = textareaRef.current?.selectionStart ?? input.length
    const start = slashStartRef.current >= 0 ? slashStartRef.current : 0
    const next = replaceSlashTrigger(input, cursor, start, command.action.text)
    slashStartRef.current = -1
    setInput(next.value)
    setSlashActive(false)
    setSlashQuery('')
    setSelectedSlashCommand(command)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(next.cursor, next.cursor)
        autoResize()
      }
    })
  }, [autoResize, input])

  const expand = useCallback(() => {
    setExpanded(true)
    requestAnimationFrame(() => autoResize())
  }, [autoResize])

  const canSend = selection.runtimeKind === 'cli-tui'
    ? !!effectiveAgent && !sending
    : (!!input.trim() || attachmentController.hasAttachments) && !!effectiveProfile && !sending

  const closeMention = useCallback(() => {
    setMentionActive(false)
  }, [])

  return {
    attachmentController,
    activeSlashOptionId,
    availableFiles,
    canSend,
    closeMention,
    composerState,
    containerRef,
    expand,
    handleInput,
    handleKeyDown,
    handleMentionSelect,
    handleSend,
    handleSlashCommandSelect,
    input,
    expanded,
    mentionActive,
    mentionQuery,
    sending,
    setActiveSlashOptionId,
    setSlashActive,
    slashActive,
    slashCommands,
    slashPanelHasResults,
    slashQuery,
    textareaRef,
  }
}

export function CapsuleComposer({ workspaceId, onSend }: CapsuleComposerProps) {
  const owner = useCapsuleComposerOwner({ workspaceId, onSend })

  /* eslint-disable react-hooks/refs */
  return (
    <div ref={owner.containerRef} className="relative">
      {owner.expanded && (
        <>
          <MentionPanel
            items={owner.availableFiles}
            query={owner.mentionQuery}
            onSelect={owner.handleMentionSelect}
            onClose={owner.closeMention}
            visible={owner.mentionActive}
          />
          <SlashCommandPanel
            commands={owner.slashCommands}
            listboxId="workspace-detail-capsule-slash-command-listbox"
            onActiveOptionIdChange={owner.setActiveSlashOptionId}
            query={owner.slashQuery}
            onSelect={owner.handleSlashCommandSelect}
            onClose={() => owner.setSlashActive(false)}
            visible={owner.slashActive}
          />
        </>
      )}

      <div
        className={cn(
          'bg-background/70 backdrop-blur-xl border border-border overflow-hidden',
          'transition-[border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          owner.expanded
            ? 'rounded-2xl shadow-lg'
            : 'rounded-[22px] shadow-sm',
        )}
      >
        <textarea
          ref={owner.textareaRef}
          value={owner.input}
          onChange={owner.handleInput}
          onFocus={owner.expand}
          onKeyDown={owner.handleKeyDown}
          onPaste={owner.attachmentController.handlePaste}
          placeholder="在此工作区开始新对话..."
          disabled={owner.sending}
          rows={1}
          data-testid="workspace-detail-capsule-textarea"
          aria-label="Workspace task message"
          aria-controls={owner.slashPanelHasResults ? 'workspace-detail-capsule-slash-command-listbox' : undefined}
          aria-expanded={owner.slashActive}
          aria-activedescendant={owner.slashPanelHasResults ? owner.activeSlashOptionId : undefined}
          className={cn(
            'block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none disabled:opacity-50',
            owner.expanded
              ? 'px-4 pt-3.5 pb-2 min-h-16 max-h-60'
              : 'px-5 py-3 min-h-11 max-h-11',
          )}
        />
        <ComposerAttachmentInput
          fileInputRef={owner.attachmentController.fileInputRef}
          onFilesSelected={owner.attachmentController.handleFilesSelected}
          supportsAttachments={owner.attachmentController.supportsAttachments}
          testId="workspace-detail-capsule-file-input"
        />

        <ComposerAttachmentList
          attachments={owner.attachmentController.attachments}
          onRemove={owner.attachmentController.removeAttachment}
          className="px-3 py-2"
        />

        <div
          className={cn(
            'grid transition-opacity duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]',
            owner.expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-t border-border/20 px-3 py-2">
              <div className="flex items-center gap-1">
                <ComposerAttachmentButton
                  disabled={owner.sending}
                  iconClassName="size-3"
                  onPickFiles={owner.attachmentController.pickFiles}
                  supportsAttachments={owner.attachmentController.supportsAttachments}
                  testId="workspace-detail-capsule-attach-btn"
                />
              </div>
              <div className="flex items-center gap-1">
                <ComposerToolbar context="capsule" state={owner.composerState} />
                <Button
                  variant="default"
                  size="icon-xs"
                  disabled={!owner.canSend}
                  onClick={() => void owner.handleSend()}
                  aria-label="Send message"
                  data-testid="workspace-detail-capsule-send-btn"
                >
                  {owner.sending
                    ? <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                    : <SendHorizonalIcon className="size-3" aria-hidden="true" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
  /* eslint-enable react-hooks/refs */
}
