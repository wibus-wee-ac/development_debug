// Input: MentionPanel, Button from UI, workspace file listing
// Output: Composer — rich input with @ path autocomplete and inline send/stop
// Position: Core input component for chat feature, used in both NewChatHome and ChatView

import { SendHorizonalIcon, SquareIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'

import type { ChatSlashCommand } from './chat-capabilities'
import type { MentionItem } from './mention-panel'
import { MentionPanel } from './mention-panel'
import { SlashCommandPanel } from './slash-command-panel'

/** Shrinks the textarea to content height, capped at 240 px. */
function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  const h = Math.min(el.scrollHeight, 240)
  el.style.height = `${h}px`
}

interface ComposerProps {
  onSend: (text: string) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  availableFiles?: MentionItem[]
  slashCommands?: ChatSlashCommand[]
  className?: string
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  /** When this value changes, append it to the composer input (used for DnD drop from outside) */
  appendText?: string
  /** Used together with appendText — increment this key to re-trigger the append when the same path is dropped again */
  appendTextKey?: number
  sessionTokens?: number
  sessionContextWindow?: number | null
}

const EMPTY_FILES: MentionItem[] = []
const EMPTY_SLASH_COMMANDS: ChatSlashCommand[] = []

interface ComposerState {
  inputValue: string
  mentionActive: boolean
  mentionQuery: string
  slashActive: boolean
  slashQuery: string
  selectedSlashCommand: ChatSlashCommand | null
}

type ComposerAction =
  | { type: 'input/changed', state: ComposerState }
  | { type: 'input/cleared' }
  | { type: 'mention/closed' }
  | { type: 'mention/selected', inputValue: string, query: string, keepOpen: boolean }
  | { type: 'slash/closed' }
  | { type: 'slash/selected', inputValue: string, command: ChatSlashCommand }
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

function getSlashCommandPrefix(command: ChatSlashCommand): string {
  return `/${command.name} `
}

function getActiveSlashCommand(inputValue: string, selectedCommand: ChatSlashCommand | null, commands: ChatSlashCommand[]): ChatSlashCommand | null {
  if (selectedCommand && inputValue.startsWith(getSlashCommandPrefix(selectedCommand))) {
    return selectedCommand
  }

  return commands.find(command => inputValue.startsWith(getSlashCommandPrefix(command))) ?? null
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
                  'transition-all',
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
  hasText,
  isStreaming,
  onSend,
  onStop,
  sessionTokens,
  sessionContextWindow,
}: {
  contextBar?: React.ReactNode
  disabled?: boolean
  hasText: boolean
  isStreaming?: boolean
  onSend: () => void
  onStop?: () => void
  sessionTokens?: number
  sessionContextWindow?: number | null
}) {
  return (
    <div className="flex items-center gap-1">
      {contextBar}
      {sessionTokens != null && sessionTokens > 0 && (
        <TokenProgress tokens={sessionTokens} contextWindow={sessionContextWindow} />
      )}
      {isStreaming
        ? (
            <Button
              variant="outline"
              size="icon-xs"
              onClick={onStop}
              aria-label="Stop generation"
              data-testid="chat-stop-btn"
            >
              <SquareIcon className="size-3" aria-hidden="true" />
            </Button>
          )
        : (
            <Button
              variant="default"
              size="icon-xs"
              disabled={disabled || !hasText}
              onClick={onSend}
              aria-label="Send message"
              data-testid="chat-send-btn"
            >
              <SendHorizonalIcon aria-hidden="true" />
            </Button>
          )}
    </div>
  )
}

export function Composer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder = '输入消息...',
  availableFiles = EMPTY_FILES,
  slashCommands = EMPTY_SLASH_COMMANDS,
  className,
  toolbar,
  contextBar,
  appendText,
  appendTextKey,
  sessionTokens,
  sessionContextWindow,
}: ComposerProps) {
  const [state, dispatch] = useReducer(composerReducer, INITIAL_COMPOSER_STATE)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Track @ trigger position for path completion
  const mentionStartRef = useRef<number>(-1)
  const activeSlashCommand = getActiveSlashCommand(state.inputValue, state.selectedSlashCommand, slashCommands)
  const slashCommandPrefix = activeSlashCommand ? getSlashCommandPrefix(activeSlashCommand) : ''
  const slashArgumentHint = activeSlashCommand?.argumentHint && state.inputValue === slashCommandPrefix
    ? activeSlashCommand.argumentHint
    : ''

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    autoResize(e.target)
    const selectedSlashCommand = getActiveSlashCommand(value, state.selectedSlashCommand, slashCommands)

    const cursor = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)

    // Check for slash command trigger at the start of a message.
    if (slashCommands.length > 0 && textBefore.startsWith('/') && !textBefore.includes('\n') && !/\s/.test(textBefore)) {
      mentionStartRef.current = -1
      dispatch({
        type: 'input/changed',
        state: {
          inputValue: value,
          mentionActive: false,
          mentionQuery: '',
          slashActive: true,
          slashQuery: textBefore.slice(1),
          selectedSlashCommand,
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
  }, [slashCommands, state.selectedSlashCommand])

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

  const handleSlashCommandSelect = useCallback((command: ChatSlashCommand) => {
    const cursor = textareaRef.current?.selectionStart ?? state.inputValue.length
    const after = state.inputValue.slice(cursor)
    const insertText = `/${command.name} `
    const newValue = `${insertText}${after}`
    dispatch({ type: 'slash/selected', inputValue: newValue, command })

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(insertText.length, insertText.length)
        autoResize(el)
      }
    })
  }, [state.inputValue])

  const handleSend = useCallback(() => {
    const text = state.inputValue.trim()
    if (!text) {
      return
    }
    onSend(text)
    dispatch({ type: 'input/cleared' })
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = 'auto'
      }
    })
  }, [onSend, state.inputValue])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Don't interfere with IME composition (e.g. Chinese input)
    if (e.nativeEvent.isComposing) {
      return
    }

    // If a picker is active, let it handle Enter/Escape/arrows
    if (state.mentionActive || state.slashActive) {
      if (['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, state.mentionActive, state.slashActive])

  // Append externally-provided text (e.g. from DnD drop on parent container)
  useEffect(() => {
    if (!appendText) {
      return
    }
    dispatch({ type: 'external/appended', text: appendText })
    textareaRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTextKey])

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
        commands={slashCommands}
        query={state.slashQuery}
        onSelect={handleSlashCommandSelect}
        onClose={() => dispatch({ type: 'slash/closed' })}
        visible={state.slashActive}
      />

      {/* Input card — modern clean style, no border-t separator */}
      <div className="rounded-xl bg-background shadow-xs border border-border/40 focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring/40 transition-all">
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
            data-testid="chat-composer-textarea"
            rows={2}
            className="relative block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none min-h-16 max-h-60 rounded-t-xl disabled:opacity-50"
          />
        </div>

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
            hasText={Boolean(state.inputValue.trim())}
            isStreaming={isStreaming}
            onSend={handleSend}
            onStop={onStop}
          />
        </div>
      </div>
    </div>
  )
}
