import type { FileUIPart } from 'ai'
import { SendHorizonalIcon, SquareIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import type {
  ComposerActionContextOptions,
  ComposerSlashCommandActionContext,
  ComposerSlashCommandActionResult,
  ComposerSlashCommandActionTools,
} from './composer-action-context'
import { readComposerActionContext } from './composer-action-context'
import type { ComposerAttachmentController } from './composer-attachment-state'
import { useComposerAttachments } from './composer-attachment-state'
import type { PendingAppshotAttachment } from './composer-attachments'
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
} from './composer-attachments'
import type { MentionItem } from './mention-panel'
import { MentionPanel } from './mention-panel'
import {
  CHAT_SLASH_COMMAND_LISTBOX_ID,
  getActiveSlashCommand,
  getSlashCommandPrefix,
  getVisibleSlashCommands,
  readSlashTriggerState,
  replaceSlashTrigger,
} from './slash-command-input'
import { getSlashCommandPanelItems, SlashCommandPanel } from './slash-command-panel'

/** Shrinks the textarea to content height, capped at 240 px. */
function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  const h = Math.min(el.scrollHeight, 240)
  el.style.height = `${h}px`
}

interface ComposerProps {
  onSend: (text: string, files: FileUIPart[], options?: { invertContinuationMode?: boolean }) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  supportsAttachments?: boolean
  placeholder?: string
  availableFiles?: MentionItem[]
  slashCommands?: ChatComposerSlashCommand[]
  onSlashCommandAction?: (command: ChatComposerSlashCommand, context: ComposerSlashCommandActionContext, tools?: ComposerSlashCommandActionTools) => void | ComposerSlashCommandActionResult | Promise<void | ComposerSlashCommandActionResult>
  className?: string
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  /** When this value changes, append it to the composer input (used for DnD drop from outside) */
  appendText?: string
  /** Used together with appendText — increment this key to re-trigger the append when the same path is dropped again */
  appendTextKey?: number
  /** File parts injected externally (used for Cmd+Cmd hotkey appshot) */
  appendExternalFileParts?: FileUIPart[]
  /** Used together with appendExternalFileParts — increment to trigger append */
  appendExternalFilePartsKey?: number
  pendingAppshots?: PendingAppshotAttachment[]
  sessionTokens?: number
  sessionContextWindow?: number | null
}

const EMPTY_FILES: MentionItem[] = []
const EMPTY_SLASH_COMMANDS: ChatComposerSlashCommand[] = []
const LEADING_HORIZONTAL_WHITESPACE_RE = /^[ \t]+/

interface ComposerState {
  inputValue: string
  mentionActive: boolean
  mentionQuery: string
  slashActive: boolean
  slashQuery: string
  selectedSlashCommand: ChatComposerSlashCommand | null
}

type ComposerAction
  = | { type: 'input/changed', state: ComposerState }
    | { type: 'input/cleared' }
    | { type: 'mention/closed' }
    | { type: 'mention/selected', inputValue: string, query: string, keepOpen: boolean }
    | { type: 'slash/closed' }
    | { type: 'slash/selected', inputValue: string, command: ChatComposerSlashCommand | null }
    | { type: 'pickers/closed' }
    | { type: 'external/appended', text: string }
    | { type: 'drop/inserted', inputValue: string }

const INITIAL_COMPOSER_STATE: ComposerState = {
  inputValue: '',
  mentionActive: false,
  mentionQuery: '',
  slashActive: false,
  slashQuery: '',
  selectedSlashCommand: null,
}

function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'input/changed':
      return action.state
    case 'input/cleared':
      return { ...INITIAL_COMPOSER_STATE }
    case 'mention/closed':
      return { ...state, mentionActive: false }
    case 'mention/selected':
      return {
        ...state,
        inputValue: action.inputValue,
        mentionActive: action.keepOpen,
        mentionQuery: action.keepOpen ? action.query : '',
        slashActive: false,
        slashQuery: '',
      }
    case 'slash/closed':
      return { ...state, slashActive: false }
    case 'slash/selected':
      return {
        ...state,
        inputValue: action.inputValue,
        slashActive: false,
        slashQuery: '',
        mentionActive: false,
        mentionQuery: '',
        selectedSlashCommand: action.command,
      }
    case 'pickers/closed':
      return {
        ...state,
        mentionActive: false,
        slashActive: false,
      }
    case 'external/appended':
      return {
        ...state,
        inputValue: state.inputValue ? `${state.inputValue} ${action.text}` : action.text,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        selectedSlashCommand: null,
      }
    case 'drop/inserted':
      return {
        ...state,
        inputValue: action.inputValue,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        selectedSlashCommand: null,
      }
    default:
      return state
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return String(tokens)
}

const TOKEN_CIRCLE_RADIUS = 7
const TOKEN_CIRCUMFERENCE = 2 * Math.PI * TOKEN_CIRCLE_RADIUS

function TokenProgress({ tokens, contextWindow }: { tokens: number, contextWindow: number | null | undefined }) {
  if (!tokens || tokens <= 0) {
    return null
  }
  const percent = contextWindow ? Math.min(1, tokens / contextWindow) : 0
  const offset = TOKEN_CIRCUMFERENCE * (1 - percent)
  const isWarning = percent > 0.7
  const isDanger = percent > 0.9
  const label = contextWindow
    ? `${formatTokenCount(tokens)} / ${formatTokenCount(contextWindow)} tokens`
    : `${formatTokenCount(tokens)} tokens`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex size-5 cursor-default items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="9" cy="9" r={TOKEN_CIRCLE_RADIUS} strokeWidth="2" className="stroke-muted" fill="none" />
            {contextWindow && (
              <circle
                cx="9"
                cy="9"
                r={TOKEN_CIRCLE_RADIUS}
                strokeWidth="2"
                fill="none"
                className={cn(
                  'transition-[stroke] duration-150',
                  isDanger ? 'stroke-destructive/70' : isWarning ? 'stroke-amber-500/70' : 'stroke-primary/50',
                )}
                strokeDasharray={TOKEN_CIRCUMFERENCE}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            )}
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">{label}</TooltipContent>
    </Tooltip>
  )
}

function ComposerActions({
  contextBar,
  disabled,
  hasDraft,
  isStreaming,
  onSend,
  onStop,
  attachmentController,
  sessionTokens,
  sessionContextWindow,
}: {
  contextBar?: React.ReactNode
  disabled?: boolean
  hasDraft: boolean
  isStreaming?: boolean
  onSend: () => void
  onStop?: () => void
  attachmentController: ComposerAttachmentController
  sessionTokens?: number
  sessionContextWindow?: number | null
}) {
  return (
    <div className="flex items-center gap-1">
      {contextBar}
      <ComposerAttachmentButton
        disabled={disabled}
        onPickFiles={attachmentController.pickFiles}
        supportsAttachments={attachmentController.supportsAttachments}
        testId="chat-attach-btn"
      />
      {sessionTokens != null && sessionTokens > 0 && (
        <TokenProgress tokens={sessionTokens} contextWindow={sessionContextWindow} />
      )}
      {isStreaming && (
        <Button
          variant="outline"
          size="icon-xs"
          onClick={onStop}
          aria-label="Stop generation"
          data-testid="chat-stop-btn"
        >
          <SquareIcon className="size-3" aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="default"
        size="icon-xs"
        disabled={disabled || !hasDraft}
        onClick={() => onSend()}
        aria-label={isStreaming ? 'Send continuation' : 'Send message'}
        data-testid="chat-send-btn"
      >
        <SendHorizonalIcon aria-hidden="true" />
      </Button>
    </div>
  )
}

export function Composer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  supportsAttachments,
  placeholder = '输入消息...',
  availableFiles = EMPTY_FILES,
  slashCommands = EMPTY_SLASH_COMMANDS,
  onSlashCommandAction,
  className,
  toolbar,
  contextBar,
  appendText,
  appendTextKey,
  appendExternalFileParts,
  appendExternalFilePartsKey,
  pendingAppshots = [],
  sessionTokens,
  sessionContextWindow,
}: ComposerProps) {
  const [state, dispatch] = useReducer(composerReducer, INITIAL_COMPOSER_STATE)
  const [activeSlashOptionId, setActiveSlashOptionId] = useState<string | undefined>(undefined)
  const attachmentController = useComposerAttachments({ supportsAttachments })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const actionTargetRef = useRef<HTMLDivElement>(null)
  const visibleSlashCommands = useMemo(
    () => getVisibleSlashCommands(slashCommands, Boolean(onSlashCommandAction)),
    [onSlashCommandAction, slashCommands],
  )
  const slashPanelItems = useMemo(
    () => getSlashCommandPanelItems(visibleSlashCommands, state.slashQuery),
    [state.slashQuery, visibleSlashCommands],
  )
  const slashPanelHasResults = state.slashActive && slashPanelItems.length > 0

  // Track @ trigger position for path completion
  const mentionStartRef = useRef<number>(-1)
  const slashStartRef = useRef<number>(-1)
  const activeSlashCommand = getActiveSlashCommand(state.inputValue, state.selectedSlashCommand, visibleSlashCommands)
  const slashCommandPrefix = activeSlashCommand ? getSlashCommandPrefix(activeSlashCommand) : ''
  const slashArgumentHint = activeSlashCommand?.argumentHint && state.inputValue.replace(LEADING_HORIZONTAL_WHITESPACE_RE, '') === slashCommandPrefix
    ? activeSlashCommand.argumentHint
    : ''

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    autoResize(e.target)
    const selectedSlashCommand = getActiveSlashCommand(value, state.selectedSlashCommand, visibleSlashCommands)

    const cursor = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)
    const slashTrigger = readSlashTriggerState(value, cursor, visibleSlashCommands, state.selectedSlashCommand)

    // Check for slash command trigger at the start of a message.
    if (slashTrigger) {
      mentionStartRef.current = -1
      slashStartRef.current = slashTrigger.start
      dispatch({
        type: 'input/changed',
        state: {
          inputValue: value,
          mentionActive: false,
          mentionQuery: '',
          slashActive: true,
          slashQuery: slashTrigger.query,
          selectedSlashCommand: slashTrigger.selectedCommand,
        },
      })
      return
    }

    // Check for @ trigger
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const afterAt = textBefore.slice(atIdx + 1)
      // Show panel if typing after @ without newline
      if (!afterAt.includes('\n')) {
        mentionStartRef.current = atIdx
        slashStartRef.current = -1
        dispatch({
          type: 'input/changed',
          state: {
            inputValue: value,
            mentionActive: true,
            mentionQuery: afterAt,
            slashActive: false,
            slashQuery: '',
            selectedSlashCommand,
          },
        })
        return
      }
    }
    dispatch({
      type: 'input/changed',
      state: {
        inputValue: value,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        selectedSlashCommand,
      },
    })
    slashStartRef.current = -1
  }, [state.selectedSlashCommand, visibleSlashCommands])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    // Replace @query with @path (inline text completion)
    const start = mentionStartRef.current
    if (start < 0) {
      return
    }

    const before = state.inputValue.slice(0, start)
    const cursor = textareaRef.current?.selectionStart ?? state.inputValue.length
    const after = state.inputValue.slice(cursor)
    // Directories: no trailing space (user may continue typing sub-path)
    // Files: add trailing space for convenience
    const suffix = item.type === 'directory' ? '/' : ' '
    const insertText = `@${item.path}${suffix}`

    const newValue = `${before}${insertText}${after}`
    // Keep mention active for directories so user can keep navigating
    if (item.type === 'directory') {
      mentionStartRef.current = start
      dispatch({ type: 'mention/selected', inputValue: newValue, query: `${item.path}/`, keepOpen: true })
    }
    else {
      mentionStartRef.current = -1
      dispatch({ type: 'mention/selected', inputValue: newValue, query: '', keepOpen: false })
    }

    // Refocus and position cursor after the inserted path
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const pos = before.length + insertText.length
        el.setSelectionRange(pos, pos)
        autoResize(el)
      }
    })
  }, [state.inputValue])

  const handleSlashCommandSelect = useCallback((command: ChatComposerSlashCommand) => {
    const cursor = textareaRef.current?.selectionStart ?? state.inputValue.length
    const start = slashStartRef.current >= 0 ? slashStartRef.current : 0

    if (command.action.kind === 'uiAction') {
      slashStartRef.current = -1
      const inputSnapshot = state.inputValue
      dispatch({ type: 'slash/selected', inputValue: state.inputValue, command: null })
      void (async () => {
        if (!onSlashCommandAction) {
          return
        }

        const readActionContext = (options?: ComposerActionContextOptions) => readComposerActionContext(actionTargetRef.current, options)
        const result = await onSlashCommandAction(command, readActionContext(), { readActionContext })
        if (result?.fileParts?.length) {
          attachmentController.appendFileParts(result.fileParts)
        }
        if (typeof result?.insertText !== 'string') {
          return
        }

        const currentValue = textareaRef.current?.value ?? inputSnapshot
        if (currentValue !== inputSnapshot) {
          return
        }

        const next = replaceSlashTrigger(inputSnapshot, cursor, start, result.insertText)
        dispatch({ type: 'slash/selected', inputValue: next.value, command: null })
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (el) {
            el.focus()
            el.setSelectionRange(next.cursor, next.cursor)
            autoResize(el)
          }
        })
      })()
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(cursor, cursor)
          autoResize(el)
        }
      })
      return
    }

    const insertText = command.action.text
    const next = replaceSlashTrigger(state.inputValue, cursor, start, insertText)
    slashStartRef.current = -1
    dispatch({ type: 'slash/selected', inputValue: next.value, command })

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(next.cursor, next.cursor)
        autoResize(el)
      }
    })
  }, [attachmentController, onSlashCommandAction, state.inputValue])

  const handleSend = useCallback((options?: { invertContinuationMode?: boolean }) => {
    const text = state.inputValue.trim()
    if (!text && attachmentController.attachments.length === 0) {
      return
    }
    if (options) {
      onSend(text, attachmentController.attachments, options)
    }
    else {
      onSend(text, attachmentController.attachments)
    }
    attachmentController.clearAttachments()
    dispatch({ type: 'input/cleared' })
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = 'auto'
      }
    })
  }, [attachmentController, onSend, state.inputValue])

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    attachmentController.handlePaste(event)
  }, [attachmentController])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Don't interfere with IME composition (e.g. Chinese input)
    if (e.nativeEvent.isComposing) {
      return
    }

    // If a picker is active, let it handle Enter/Escape/arrows.
    if (state.mentionActive || (state.slashActive && slashPanelHasResults)) {
      if (['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        return
      }
    }

    if (e.key === 'Enter' && e.shiftKey && e.metaKey) {
      e.preventDefault()
      handleSend({ invertContinuationMode: true })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, slashPanelHasResults, state.mentionActive, state.slashActive])

  // Append externally-provided text (e.g. from DnD drop on parent container)
  useEffect(() => {
    if (!appendText) {
      return
    }
    dispatch({ type: 'external/appended', text: appendText })
    textareaRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTextKey])

  // Append externally-injected file parts (e.g. from Cmd+Cmd appshot hotkey)
  useLayoutEffect(() => {
    if (!appendExternalFileParts || appendExternalFileParts.length === 0) {
      return
    }
    attachmentController.appendFileParts(appendExternalFileParts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendExternalFilePartsKey])

  // Close mention on blur after a short delay (to allow click selection)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const handleBlur = () => {
      timer = setTimeout(() => {
        dispatch({ type: 'pickers/closed' })
      }, 150)
    }
    const handleFocus = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    el.addEventListener('blur', handleBlur)
    el.addEventListener('focus', handleFocus)
    return () => {
      el.removeEventListener('blur', handleBlur)
      el.removeEventListener('focus', handleFocus)
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  return (
    <div className={cn('relative w-full', className)}>
      {/* Mention panel — pops up above the composer */}
      <MentionPanel
        items={availableFiles}
        query={state.mentionQuery}
        onSelect={handleMentionSelect}
        onClose={() => dispatch({ type: 'mention/closed' })}
        visible={state.mentionActive}
      />
      <SlashCommandPanel
        commands={visibleSlashCommands}
        listboxId={CHAT_SLASH_COMMAND_LISTBOX_ID}
        onActiveOptionIdChange={setActiveSlashOptionId}
        query={state.slashQuery}
        onSelect={handleSlashCommandSelect}
        onClose={() => dispatch({ type: 'slash/closed' })}
        visible={state.slashActive}
      />

      {/* Input card — modern clean style, no border-t separator */}
      <div
        ref={actionTargetRef}
        className="rounded-xl bg-background shadow-xs border border-border/40 focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring/40 transition-[border-color,box-shadow] duration-150"
        data-testid="chat-composer-action-target"
        data-composer-action-target
      >
        <ComposerAttachmentInput
          fileInputRef={attachmentController.fileInputRef}
          onFilesSelected={attachmentController.handleFilesSelected}
          supportsAttachments={attachmentController.supportsAttachments}
          testId="chat-file-input"
        />
        {/* Textarea */}
        <div className="relative">
          {slashArgumentHint && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 min-h-16 max-h-60 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3.5 pb-2 text-sm text-transparent"
              data-testid="slash-argument-hint"
            >
              <span>{state.inputValue}</span>
              <span className="text-muted-foreground/45">{slashArgumentHint}</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={state.inputValue}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const path = readWorkspaceFileDragText(e.dataTransfer)
              if (path) {
                dispatch({ type: 'drop/inserted', inputValue: state.inputValue ? `${state.inputValue} ${path}` : path })
              }
            }}
            onDragOver={e => e.preventDefault()}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Message"
            aria-controls={slashPanelHasResults ? CHAT_SLASH_COMMAND_LISTBOX_ID : undefined}
            aria-expanded={state.slashActive}
            aria-activedescendant={slashPanelHasResults ? activeSlashOptionId : undefined}
            data-testid="chat-composer-textarea"
            rows={2}
            className="relative block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none min-h-16 max-h-60 rounded-t-xl disabled:opacity-50"
          />
        </div>

        <ComposerAttachmentList
          attachments={attachmentController.attachments}
          onRemove={attachmentController.removeAttachment}
          pendingAppshots={pendingAppshots}
        />

        {/* Action bar — subtle, blends with the card */}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {/* Left: custom toolbar from parent */}
          <div className="flex items-center gap-1">
            {toolbar}
          </div>

          <ComposerActions
            sessionTokens={sessionTokens}
            sessionContextWindow={sessionContextWindow}
            contextBar={contextBar}
            disabled={disabled}
            hasDraft={Boolean(state.inputValue.trim()) || attachmentController.hasAttachments}
            isStreaming={isStreaming}
            attachmentController={attachmentController}
            onSend={handleSend}
            onStop={onStop}
          />
        </div>
      </div>
    </div>
  )
}
