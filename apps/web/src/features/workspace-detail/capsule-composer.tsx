import {
  Loader2Icon,
  SendHorizonalIcon,
} from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import type { MentionItem } from '~/features/chat'
import { MentionPanel } from '~/features/chat/mention-panel'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'

interface CapsuleComposerProps {
  workspaceId: string
  onSend: (text: string, opts: { runtimeKind: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui', agentId?: string, agentProfileId?: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' }) => void | Promise<void>
}

function useCapsuleComposerOwner({ workspaceId, onSend }: CapsuleComposerProps) {
  const composerState = useComposerState({ context: 'capsule' })
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState

  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const mentionStartRef = useRef<number>(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const afterAt = textBefore.slice(atIdx + 1)
      if (!afterAt.includes('\n')) {
        setMentionActive(true)
        setMentionQuery(afterAt)
        mentionStartRef.current = atIdx
        return
      }
    }
    setMentionActive(false)
    setMentionQuery('')
  }, [autoResize])

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
    else if (!text || !effectiveProfile) {
      return
    }
    setSending(true)
    try {
      await onSend(text, {
        runtimeKind: selection.runtimeKind,
        ...(selection.runtimeKind === 'cli-tui'
          ? { agentId: effectiveAgent?.id }
          : {
              agentProfileId: effectiveProfile?.id,
              modelId: effectiveModel?.id,
              thinkingEffort: selection.thinkingEffort ?? undefined,
            }),
      })
      setInput('')
      setExpanded(false)
      setMentionActive(false)
    }
    finally {
      setSending(false)
    }
  }, [onSend, effectiveAgent, effectiveProfile, effectiveModel, selection.runtimeKind, selection.thinkingEffort, input])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return
    }
    if (mentionActive && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
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
  }, [handleSend, mentionActive])

  const expand = useCallback(() => {
    setExpanded(true)
    requestAnimationFrame(() => autoResize())
  }, [autoResize])

  const canSend = selection.runtimeKind === 'cli-tui'
    ? !!effectiveAgent && !sending
    : !!input.trim() && !!effectiveProfile && !sending

  const closeMention = useCallback(() => {
    setMentionActive(false)
  }, [])

  return {
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
    input,
    expanded,
    mentionActive,
    mentionQuery,
    sending,
    textareaRef,
  }
}

export function CapsuleComposer({ workspaceId, onSend }: CapsuleComposerProps) {
  const owner = useCapsuleComposerOwner({ workspaceId, onSend })

  /* eslint-disable react-hooks/refs */
  return (
    <div ref={owner.containerRef} className="relative">
      {owner.expanded && (
        <MentionPanel
          items={owner.availableFiles}
          query={owner.mentionQuery}
          onSelect={owner.handleMentionSelect}
          onClose={owner.closeMention}
          visible={owner.mentionActive}
        />
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
          placeholder="在此工作区开始新对话..."
          disabled={owner.sending}
          rows={1}
          data-testid="workspace-detail-capsule-textarea"
          aria-label="Workspace task message"
          className={cn(
            'block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none disabled:opacity-50',
            owner.expanded
              ? 'px-4 pt-3.5 pb-2 min-h-16 max-h-60'
              : 'px-5 py-3 min-h-11 max-h-11',
          )}
        />

        <div
          className={cn(
            'grid transition-opacity duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]',
            owner.expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-t border-border/20 px-3 py-2">
              <div className="flex items-center gap-1" />
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
