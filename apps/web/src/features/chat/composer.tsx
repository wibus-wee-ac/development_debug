import type { FileUIPart } from 'ai'
import { LoaderCircleIcon, SendHorizonalIcon, SquareIcon, SquareTerminalIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { formatTokenCount } from '~/lib/number-format'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'

import type { ChatContextPart } from './chat-context-parts'
import { readBangCommand } from './bang-command'
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
import type { PromptEditorController, PromptEditorSnapshot, PromptEditorTriggerRange } from './prompt-editor'
import { PromptEditor } from './prompt-editor'
import type { SkillMentionItem } from './skill-mention-panel'
import { SkillMentionPanel } from './skill-mention-panel'
import {
  CHAT_SLASH_COMMAND_LISTBOX_ID,
  getActiveSlashCommand,
  getSlashCommandPanelItems,
  getSlashCommandPrefix,
  getVisibleSlashCommands,
  isSlashCommandAwaitingRequiredArgument,
  replaceSlashTrigger,
} from './slash-command-input'
import { SlashCommandPanel } from './slash-command-panel'

export type ComposerSendHandler = (
  text: string,
  files: FileUIPart[],
  contextParts: ChatContextPart[],
  options?: { invertContinuationMode?: boolean },
) => void | boolean | Promise<void | boolean>

export interface ComposerSendController {
  submit: ComposerSendHandler
  stop?: () => void
  isStreaming?: boolean
  isSending?: boolean
  disabled?: boolean
  sendDisabled?: boolean
  allowEmptySend?: boolean
}

export interface ComposerCommandController {
  commands?: ChatComposerSlashCommand[]
  runAction?: (command: ChatComposerSlashCommand, context: ComposerSlashCommandActionContext, tools?: ComposerSlashCommandActionTools) => void | ComposerSlashCommandActionResult | Promise<void | ComposerSlashCommandActionResult>
}

export interface ComposerAttachmentIntegration {
  supportsAttachments?: boolean
  /** File parts injected externally, for example from native Appshot capture. */
  appendFileParts?: FileUIPart[]
  /** Used together with appendFileParts to re-trigger the append. */
  appendFilePartsKey?: number
  pendingAppshots?: PendingAppshotAttachment[]
  onActionTargetElementChange?: (element: HTMLDivElement | null) => void
}

export interface ComposerSlots {
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
}

export interface ComposerExternalSignals {
  /** Replaces the current draft when the key changes, used by quick actions. */
  replaceText?: string
  replaceTextKey?: number
  /** Appends text to the composer input when the key changes, used by parent DnD. */
  appendText?: string
  appendTextKey?: number
}

export interface ComposerViewOptions {
  placeholder?: string
  availableFiles?: MentionItem[]
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  availableSkills?: SkillMentionItem[]
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  className?: string
  cardClassName?: string
  textareaClassName?: string
  textareaRows?: number
  attachmentListClassName?: string
  actionBarClassName?: string
  toolbarClassName?: string
  actionsClassName?: string
  attachButtonClassName?: string
  attachIconClassName?: string
  sendButtonClassName?: string
  onDraftChange?: (value: string) => void
  onFocusChange?: (focused: boolean) => void
  sessionTokens?: number
  sessionContextWindow?: number | null
}

export interface ComposerTestIds {
  actionTarget?: string
  textarea?: string
  fileInput?: string
  attachButton?: string
  sendButton?: string
  stopButton?: string
}

export interface ComposerAccessibilityOptions {
  textareaAriaLabel?: string
  sendButtonAriaLabel?: string
}

export interface ComposerProps {
  send: ComposerSendController
  commands?: ComposerCommandController
  attachments?: ComposerAttachmentIntegration
  slots?: ComposerSlots
  externalSignals?: ComposerExternalSignals
  view?: ComposerViewOptions
  testIds?: ComposerTestIds
  accessibility?: ComposerAccessibilityOptions
}

const EMPTY_FILES: MentionItem[] = []
const EMPTY_SKILLS: SkillMentionItem[] = []
const EMPTY_SLASH_COMMANDS: ChatComposerSlashCommand[] = []
const LEADING_HORIZONTAL_WHITESPACE_RE = /^[ \t]+/

function readBangCommandDraft(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('!') || normalized.includes('\n') || normalized.includes('\r')) {
    return null
  }
  const preview = normalized.slice(1).trim()
  return preview || '!'
}

interface ComposerState {
  inputValue: string
  mentionActive: boolean
  mentionQuery: string
  slashActive: boolean
  slashQuery: string
  skillActive: boolean
  skillQuery: string
  contextParts: ChatContextPart[]
  selectedSlashCommand: ChatComposerSlashCommand | null
}

type ComposerAction
  = | { type: 'input/changed', state: ComposerState }
    | { type: 'input/cleared' }
    | { type: 'mention/closed' }
    | { type: 'mention/selected' }
    | { type: 'slash/closed' }
    | { type: 'slash/selected', inputValue: string, command: ChatComposerSlashCommand | null }
    | { type: 'skill/closed' }
    | { type: 'skill/selected' }
    | { type: 'pickers/closed' }

const INITIAL_COMPOSER_STATE: ComposerState = {
  inputValue: '',
  mentionActive: false,
  mentionQuery: '',
  slashActive: false,
  slashQuery: '',
  skillActive: false,
  skillQuery: '',
  contextParts: [],
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
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        skillActive: false,
        skillQuery: '',
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
        skillActive: false,
        skillQuery: '',
        selectedSlashCommand: action.command,
      }
    case 'skill/closed':
      return { ...state, skillActive: false }
    case 'skill/selected':
      return {
        ...state,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        skillActive: false,
        skillQuery: '',
        selectedSlashCommand: null,
      }
    case 'pickers/closed':
      return {
        ...state,
        mentionActive: false,
        slashActive: false,
        skillActive: false,
      }
    default:
      return state
  }
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

function ComposerSendIcon({ isBangMode, isSending }: { isBangMode?: boolean, isSending?: boolean }) {
  if (isSending) {
    return <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
  }

  return (
    <span className="relative size-3.5" aria-hidden="true">
      <SendHorizonalIcon
        className={cn(
          'absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          isBangMode ? 'scale-[0.25] opacity-0 blur-[4px]' : 'scale-100 opacity-100 blur-0',
        )}
      />
      <SquareTerminalIcon
        className={cn(
          'absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          isBangMode ? 'scale-100 opacity-100 blur-0' : 'scale-[0.25] opacity-0 blur-[4px]',
        )}
      />
    </span>
  )
}

function ComposerActions({
  actionsClassName,
  attachButtonClassName,
  attachIconClassName,
  contextBar,
  disabled,
  hasDraft,
  isBangMode,
  isSending,
  isStreaming,
  onSend,
  onStop,
  sendDisabled,
  sendBlocked,
  attachButtonTestId,
  sendButtonClassName,
  sendButtonTestId,
  stopButtonTestId,
  attachmentController,
  sessionTokens,
  sessionContextWindow,
  sendButtonAriaLabel,
}: {
  actionsClassName?: string
  attachButtonClassName?: string
  attachIconClassName?: string
  contextBar?: React.ReactNode
  disabled?: boolean
  hasDraft: boolean
  isBangMode?: boolean
  isSending?: boolean
  isStreaming?: boolean
  onSend: () => void
  onStop?: () => void
  sendDisabled?: boolean
  sendBlocked?: boolean
  attachButtonTestId: string
  sendButtonClassName?: string
  sendButtonTestId: string
  stopButtonTestId: string
  attachmentController: ComposerAttachmentController
  sessionTokens?: number
  sessionContextWindow?: number | null
  sendButtonAriaLabel?: string
}) {
  return (
    <div className={cn('flex items-center gap-1', actionsClassName)}>
      {contextBar}
      <ComposerAttachmentButton
        disabled={disabled}
        className={attachButtonClassName}
        iconClassName={attachIconClassName}
        onPickFiles={attachmentController.pickFiles}
        supportsAttachments={attachmentController.supportsAttachments}
        testId={attachButtonTestId}
      />
      {sessionTokens != null && sessionTokens > 0 && (
        <TokenProgress tokens={sessionTokens} contextWindow={sessionContextWindow} />
      )}
      {isStreaming && hasDraft && (
        <Button
          variant="outline"
          size="icon-xs"
          disabled={disabled || sendDisabled || sendBlocked}
          onClick={() => onSend()}
          aria-label={sendButtonAriaLabel ?? (isBangMode ? 'Run shell command' : 'Send continuation')}
          className={sendButtonClassName}
          data-testid={sendButtonTestId}
        >
          <ComposerSendIcon isBangMode={isBangMode} isSending={isSending} />
        </Button>
      )}
      {isStreaming
        ? (
            <Button
              variant="default"
              size="icon-xs"
              onClick={onStop}
              aria-label="Stop generation"
              className={sendButtonClassName}
              data-testid={stopButtonTestId}
            >
              <SquareIcon className="size-3" aria-hidden="true" />
            </Button>
          )
        : (
            <Button
              variant="default"
              size="icon-xs"
              disabled={disabled || sendDisabled || sendBlocked || !hasDraft}
              onClick={() => onSend()}
              aria-label={sendButtonAriaLabel ?? (isBangMode ? 'Run shell command' : 'Send message')}
              className={sendButtonClassName}
              data-testid={sendButtonTestId}
            >
              <ComposerSendIcon isBangMode={isBangMode} isSending={isSending} />
            </Button>
          )}
    </div>
  )
}

export function Composer({
  send,
  commands,
  attachments,
  slots,
  externalSignals,
  view,
  testIds,
  accessibility,
}: ComposerProps) {
  const {
    submit,
    isStreaming,
    isSending,
    disabled,
    sendDisabled,
    allowEmptySend,
  } = send
  const slashCommands = commands?.commands ?? EMPTY_SLASH_COMMANDS
  const onSlashCommandAction = commands?.runAction
  const supportsAttachments = attachments?.supportsAttachments
  const appendExternalFileParts = attachments?.appendFileParts
  const appendExternalFilePartsKey = attachments?.appendFilePartsKey
  const pendingAppshots = attachments?.pendingAppshots ?? []
  const onActionTargetElementChange = attachments?.onActionTargetElementChange
  const toolbar = slots?.toolbar
  const contextBar = slots?.contextBar
  const replaceText = externalSignals?.replaceText
  const replaceTextKey = externalSignals?.replaceTextKey
  const appendText = externalSignals?.appendText
  const appendTextKey = externalSignals?.appendTextKey
  const {
    placeholder = 'Message...',
    availableFiles = EMPTY_FILES,
    searchFiles,
    availableSkills = EMPTY_SKILLS,
    searchSkills,
    className,
    cardClassName,
    textareaClassName,
    attachmentListClassName,
    actionBarClassName,
    toolbarClassName,
    actionsClassName,
    attachButtonClassName,
    attachIconClassName,
    sendButtonClassName,
    onDraftChange,
    onFocusChange,
    sessionTokens,
    sessionContextWindow,
  } = view ?? {}
  const {
    textareaAriaLabel = 'Message',
    sendButtonAriaLabel,
  } = accessibility ?? {}
  const [state, dispatch] = useReducer(composerReducer, INITIAL_COMPOSER_STATE)
  const [activeSlashOptionId, setActiveSlashOptionId] = useState<string | undefined>(undefined)
  const attachmentController = useComposerAttachments({ supportsAttachments })
  const promptEditorRef = useRef<PromptEditorController>(null)
  const actionTargetRef = useRef<HTMLDivElement>(null)
  const setActionTargetElement = useCallback((element: HTMLDivElement | null) => {
    actionTargetRef.current = element
    onActionTargetElementChange?.(element)
  }, [onActionTargetElementChange])
  const visibleSlashCommands = useMemo(
    () => getVisibleSlashCommands(slashCommands, Boolean(onSlashCommandAction)),
    [onSlashCommandAction, slashCommands],
  )
  const slashPanelItems = useMemo(
    () => getSlashCommandPanelItems(visibleSlashCommands, state.slashQuery),
    [state.slashQuery, visibleSlashCommands],
  )
  const slashPanelHasResults = state.slashActive && slashPanelItems.length > 0

  const mentionRangeRef = useRef<PromptEditorTriggerRange | null>(null)
  const slashRangeRef = useRef<PromptEditorTriggerRange | null>(null)
  const skillRangeRef = useRef<PromptEditorTriggerRange | null>(null)
  const activeSlashCommand = getActiveSlashCommand(state.inputValue, state.selectedSlashCommand, visibleSlashCommands)
  const slashCommandPrefix = activeSlashCommand ? getSlashCommandPrefix(activeSlashCommand) : ''
  const slashAwaitingRequiredArgument = activeSlashCommand
    ? isSlashCommandAwaitingRequiredArgument(state.inputValue, activeSlashCommand)
    : false
  const slashArgumentHint = activeSlashCommand?.argumentHint && (
    state.inputValue.replace(LEADING_HORIZONTAL_WHITESPACE_RE, '') === slashCommandPrefix
    || slashAwaitingRequiredArgument
  )
    ? activeSlashCommand.argumentHint
    : ''
  const actionTargetTestId = testIds?.actionTarget ?? 'chat-composer-action-target'
  const textareaTestId = testIds?.textarea ?? 'chat-composer-textarea'
  const fileInputTestId = testIds?.fileInput ?? 'chat-file-input'
  const attachButtonTestId = testIds?.attachButton ?? 'chat-attach-btn'
  const sendButtonTestId = testIds?.sendButton ?? 'chat-send-btn'
  const stopButtonTestId = testIds?.stopButton ?? 'chat-stop-btn'
  const hasDraft = Boolean(state.inputValue.trim()) || attachmentController.hasAttachments || state.contextParts.length > 0 || Boolean(allowEmptySend)
  const bangCommandPreview = !attachmentController.hasAttachments && state.contextParts.length === 0
    ? readBangCommandDraft(state.inputValue)
    : null
  const bangCommand = !attachmentController.hasAttachments && state.contextParts.length === 0
    ? readBangCommand(state.inputValue)
    : null
  const isBangMode = bangCommandPreview !== null
  const sendBlocked = (isBangMode && bangCommand === null) || slashAwaitingRequiredArgument
  const effectiveDisabled = disabled || isSending

  const handleEditorChange = useCallback((snapshot: PromptEditorSnapshot) => {
    const selectedSlashCommand = snapshot.trigger?.kind === 'slash'
      ? snapshot.trigger.selectedCommand
      : getActiveSlashCommand(snapshot.text, state.selectedSlashCommand, visibleSlashCommands)

    mentionRangeRef.current = snapshot.trigger?.kind === 'file' ? snapshot.trigger.range : null
    slashRangeRef.current = snapshot.trigger?.kind === 'slash' ? snapshot.trigger.range : null
    skillRangeRef.current = snapshot.trigger?.kind === 'skill' ? snapshot.trigger.range : null

    dispatch({
      type: 'input/changed',
      state: {
        ...state,
        inputValue: snapshot.text,
        contextParts: snapshot.contextParts,
        mentionActive: snapshot.trigger?.kind === 'file',
        mentionQuery: snapshot.trigger?.kind === 'file' ? snapshot.trigger.query : '',
        slashActive: snapshot.trigger?.kind === 'slash',
        slashQuery: snapshot.trigger?.kind === 'slash' ? snapshot.trigger.query : '',
        skillActive: snapshot.trigger?.kind === 'skill',
        skillQuery: snapshot.trigger?.kind === 'skill' ? snapshot.trigger.query : '',
        selectedSlashCommand,
      },
    })
  }, [state, visibleSlashCommands])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const range = mentionRangeRef.current
    if (!range) {
      return
    }
    promptEditorRef.current?.insertFileMention(item, range)
    dispatch({ type: 'mention/selected' })
  }, [])

  const handleSkillSelect = useCallback((item: SkillMentionItem) => {
    const range = skillRangeRef.current
    if (!range) {
      return
    }
    promptEditorRef.current?.insertSkillMention(item, range)
    dispatch({ type: 'skill/selected' })
  }, [])

  const handleSlashCommandSelect = useCallback((command: ChatComposerSlashCommand) => {
    const range = slashRangeRef.current ?? { from: 1, to: Math.max(1, state.inputValue.length + 1) }
    const inputSnapshot = state.inputValue

    if (command.action.kind === 'uiAction') {
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

        const currentValue = promptEditorRef.current?.getText() ?? inputSnapshot
        if (currentValue !== inputSnapshot) {
          return
        }

        const next = replaceSlashTrigger(inputSnapshot, range.to - 1, range.from - 1, result.insertText)
        dispatch({ type: 'slash/selected', inputValue: next.value, command: null })
        promptEditorRef.current?.replaceRangeWithText(range, result.insertText)
      })()
      requestAnimationFrame(() => promptEditorRef.current?.focus())
      return
    }

    if (command.action.kind === 'submitText') {
      const submitText = command.action.text
      const hasComposerPayload = attachmentController.attachments.length > 0 || state.contextParts.length > 0
      if (disabled || isSending || sendDisabled || (command.action.requiresEmptyComposer && hasComposerPayload)) {
        requestAnimationFrame(() => promptEditorRef.current?.focus())
        return
      }

      dispatch({ type: 'slash/selected', inputValue: state.inputValue, command: null })
      void (async () => {
        const result = await submit(submitText, [], [])
        if (result === false) {
          return
        }
        attachmentController.clearAttachments()
        promptEditorRef.current?.clear()
        dispatch({ type: 'input/cleared' })
      })()
      requestAnimationFrame(() => promptEditorRef.current?.focus())
      return
    }

    const insertText = command.action.text
    const next = replaceSlashTrigger(state.inputValue, range.to - 1, range.from - 1, insertText)
    dispatch({ type: 'slash/selected', inputValue: next.value, command })
    promptEditorRef.current?.replaceRangeWithText(range, insertText)
  }, [attachmentController, disabled, isSending, onSlashCommandAction, sendDisabled, state.contextParts.length, state.inputValue, submit])

  const handleSend = useCallback((options?: { invertContinuationMode?: boolean }) => {
    const text = state.inputValue.trim()
    if (disabled || isSending || sendDisabled || sendBlocked) {
      return
    }
    if (!allowEmptySend && !text && attachmentController.attachments.length === 0 && state.contextParts.length === 0) {
      return
    }

    void (async () => {
      const result = options
        ? await submit(text, attachmentController.attachments, state.contextParts, options)
        : await submit(text, attachmentController.attachments, state.contextParts)
      if (result === false) {
        return
      }
      attachmentController.clearAttachments()
      promptEditorRef.current?.clear()
      dispatch({ type: 'input/cleared' })
    })()
  }, [allowEmptySend, attachmentController, disabled, isSending, sendBlocked, sendDisabled, state.contextParts, state.inputValue, submit])

  const handlePaste = useCallback((event: ClipboardEvent) => {
    attachmentController.handlePaste(event as unknown as React.ClipboardEvent<HTMLElement>)
  }, [attachmentController])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't interfere with IME composition (e.g. Chinese input)
    if (e.isComposing) {
      return
    }

    // If a picker is active, let it handle Enter/Escape/arrows/Tab.
    if (state.mentionActive || state.skillActive || (state.slashActive && slashPanelHasResults)) {
      if (['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
        return
      }
    }

    if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend({ invertContinuationMode: true })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, slashPanelHasResults, state.mentionActive, state.skillActive, state.slashActive])

  // Append externally-provided text (e.g. from DnD drop on parent container)
  useEffect(() => {
    if (!appendText) {
      return
    }
    promptEditorRef.current?.appendText(appendText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTextKey])

  useEffect(() => {
    if (typeof replaceText !== 'string') {
      return
    }
    promptEditorRef.current?.setText(replaceText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceTextKey])

  useEffect(() => {
    onDraftChange?.(state.inputValue)
  }, [onDraftChange, state.inputValue])

  // Append externally-injected file parts (e.g. from Cmd+Cmd appshot hotkey)
  useLayoutEffect(() => {
    if (!appendExternalFileParts || appendExternalFileParts.length === 0) {
      return
    }
    attachmentController.appendFileParts(appendExternalFileParts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendExternalFilePartsKey])

  const handleEditorFocusChange = useCallback((focused: boolean) => {
    onFocusChange?.(focused)
    if (!focused) {
      window.setTimeout(() => {
        dispatch({ type: 'pickers/closed' })
      }, 150)
    }
  }, [onFocusChange])

  const handleEditorDrop = useCallback((event: DragEvent) => {
    const path = event.dataTransfer ? readWorkspaceFileDragText(event.dataTransfer) : ''
    if (!path) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    promptEditorRef.current?.appendText(path)
    return true
  }, [])

  return (
    <div className={cn('relative w-full', className)}>
      {/* Mention panel — pops up above the composer */}
      <MentionPanel
        items={availableFiles}
        query={state.mentionQuery}
        searchItems={searchFiles}
        onSelect={handleMentionSelect}
        onClose={() => dispatch({ type: 'mention/closed' })}
        visible={state.mentionActive}
      />
      <SkillMentionPanel
        items={availableSkills}
        query={state.skillQuery}
        searchItems={searchSkills}
        onSelect={handleSkillSelect}
        onClose={() => dispatch({ type: 'skill/closed' })}
        visible={state.skillActive}
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
        ref={setActionTargetElement}
        className={cn(
          'rounded-xl bg-background shadow-xs border border-border/40 focus-within:ring-0 focus-within:border-ring/40 transition-[border-color,box-shadow] duration-150',
          cardClassName,
        )}
        data-testid={actionTargetTestId}
        data-composer-action-target
      >
        <ComposerAttachmentInput
          fileInputRef={attachmentController.fileInputRef}
          onFilesSelected={attachmentController.handleFilesSelected}
          supportsAttachments={attachmentController.supportsAttachments}
          testId={fileInputTestId}
        />
        {/* Prompt editor */}
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
          <PromptEditor
            ref={promptEditorRef}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleEditorDrop}
            onChange={handleEditorChange}
            onFocusChange={handleEditorFocusChange}
            placeholder={placeholder}
            disabled={effectiveDisabled}
            ariaLabel={textareaAriaLabel}
            ariaControls={slashPanelHasResults ? CHAT_SLASH_COMMAND_LISTBOX_ID : undefined}
            ariaExpanded={state.slashActive}
            ariaActiveDescendant={slashPanelHasResults ? activeSlashOptionId : undefined}
            testId={textareaTestId}
            className={textareaClassName}
            selectedSlashCommand={state.selectedSlashCommand}
            slashCommands={visibleSlashCommands}
          />
        </div>

        <ComposerAttachmentList
          attachments={attachmentController.attachments}
          onRemove={attachmentController.removeAttachment}
          pendingAppshots={pendingAppshots}
          className={attachmentListClassName}
        />

        {/* Action bar — subtle, blends with the card */}
        <div className={cn('flex items-center justify-between gap-2 px-3 py-2', actionBarClassName)}>
          {/* Left: custom toolbar from parent */}
          <div className={cn('min-w-0 flex-1', toolbarClassName)}>
            <div className="relative h-7 min-w-0 overflow-hidden">
              <div
                className={cn(
                  'absolute inset-x-0 top-1/2 flex min-w-0 -translate-y-1/2 items-center gap-1 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                  isBangMode && 'pointer-events-none translate-y-2 opacity-0 blur-[3px]',
                )}
              >
                {toolbar}
              </div>
              <div
                className={cn(
                  'pointer-events-none absolute inset-x-0 top-1/2 flex min-w-0 items-center transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                  isBangMode
                    ? '-translate-y-1/2 opacity-100 blur-0'
                    : 'translate-y-2 opacity-0 blur-[3px]',
                )}
              >
                <div
                  className="inline-flex h-6 max-w-64 items-center gap-1.5 rounded-md bg-muted px-2 font-mono text-[11px] text-muted-foreground"
                  data-testid="chat-bang-command-indicator"
                >
                  <SquareTerminalIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="truncate">{bangCommandPreview}</span>
                  {sendBlocked && <span className="ml-0.5 h-3 w-1 rounded-full bg-muted-foreground/60" aria-hidden="true" />}
                </div>
              </div>
            </div>
          </div>

          <ComposerActions
            actionsClassName={actionsClassName}
            attachButtonClassName={attachButtonClassName}
            attachIconClassName={attachIconClassName}
            sessionTokens={sessionTokens}
            sessionContextWindow={sessionContextWindow}
            contextBar={contextBar}
            disabled={effectiveDisabled}
            hasDraft={hasDraft}
            isBangMode={isBangMode}
            isSending={isSending}
            isStreaming={isStreaming}
            attachmentController={attachmentController}
            onSend={handleSend}
            onStop={send.stop}
            sendDisabled={sendDisabled}
            sendBlocked={sendBlocked}
            attachButtonTestId={attachButtonTestId}
            sendButtonAriaLabel={sendButtonAriaLabel}
            sendButtonClassName={sendButtonClassName}
            sendButtonTestId={sendButtonTestId}
            stopButtonTestId={stopButtonTestId}
          />
        </div>
      </div>
    </div>
  )
}
