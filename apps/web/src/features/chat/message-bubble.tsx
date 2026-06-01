import { Streamdown } from '@cradle/streamdown'
import type { UIMessage } from 'ai'
import isEqual from 'fast-deep-equal'
import { ActivityIcon, CheckIcon, CopyIcon, FileIcon, HashIcon, ImageIcon, PackageIcon, TargetIcon, TimerIcon } from 'lucide-react'
import { m } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useStreamdownStore } from '~/store/streamdown'

import { AppshotAttachmentCard } from './appshot-attachment'
import { readCradleAppshotMetadata } from './appshot-attachment-model'
import { GroupedToolCallBlock } from './blocks/grouped-tool-call-block'
import { ReasoningBlock } from './blocks/reasoning-block'
import { ToolCallBlock } from './blocks/tool-call-block'
import type { ChatSkillContextMessagePart } from './chat-context-parts'
import { isChatSkillContextPart, readSkillContextLabel, readSkillContextPart } from './chat-context-parts'
import { readChatContinuationMetadata } from './chat-continuation-metadata'
import type { ChatRenderItem, ChatRenderSegment, FileMessagePart } from './chat-render-plan'
import { groupMessagePartRefs, groupMessageParts, splitExecutionPhase, splitSegmentExecutionPhase } from './chat-render-plan'
import type { ChatToolEntity } from './chat-tool-entities'
import { readSubagentOutputMessage } from './chat-tool-entities'
import { describeToolCall } from './tool-ui-classifier'

const BUBBLE_TRANSITION = { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } as const
const IS_DEV = import.meta.env.DEV
const THINKING_IDLE_DELAY_MS = 900
const MESSAGE_STREAMING_ANIMATION_MAX_CHARS = 12000
const SUBAGENT_STREAMING_ANIMATION_MAX_CHARS = 4000
const ACTIVE_TOOL_STATES = new Set(['input-streaming', 'input-available', 'approval-requested'])

function FileAttachmentBlock({ part }: { part: FileMessagePart }) {
  const label = part.filename ?? part.mediaType
  const isImage = part.mediaType.startsWith('image/')
  const appshotMetadata = readCradleAppshotMetadata(part)

  if (appshotMetadata) {
    return <AppshotAttachmentCard variant="thread" metadata={appshotMetadata} />
  }

  return (
    <div
      className="my-1 overflow-hidden rounded-md border border-border/60 bg-background/60"
      data-testid="chat-file-attachment"
    >
      {isImage && (
        <img
          src={part.url}
          alt={label}
          className="max-h-48 w-full object-cover"
          loading="lazy"
          data-testid="chat-file-attachment-image"
        />
      )}
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-2 text-xs">
        {isImage
          ? <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          : <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{part.mediaType}</div>
        </div>
      </div>
    </div>
  )
}

function SkillContextBlock({ part }: { part: ChatSkillContextMessagePart }) {
  const skill = readSkillContextPart(part)
  return (
    <div className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md bg-background/55 px-2 py-1 text-xs text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.55)]">
      <PackageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{readSkillContextLabel(skill)}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{skill.scope}</span>
    </div>
  )
}

function RunDebugCaption({ messageId }: { messageId: string }) {
  const meta = useChatStore(chatSelectors.runDisplayMeta(messageId))
  if (!IS_DEV || !meta) {
    return null
  }

  const ttfbMs = meta.firstEventAtMs === null
    ? null
    : Math.max(0, meta.firstEventAtMs - meta.requestStartedAtMs)
  const ttftMs = meta.firstContentAtMs === null
    ? null
    : Math.max(0, meta.firstContentAtMs - meta.requestStartedAtMs)
  const totalMs = meta.completedAtMs === null
    ? null
    : Math.max(0, meta.completedAtMs - meta.requestStartedAtMs)
  const shortRunId = meta.runId ? `${meta.runId.slice(0, 8)}…` : 'pending'

  return (
    <TooltipProvider delayDuration={250}>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Tooltip>
          <TooltipTrigger
            render={(
              <Badge
                variant="outline"
                className="h-5 max-w-full gap-1 border-border/50 bg-muted/25 px-1.5 font-mono font-normal text-[10px] text-muted-foreground tabular-nums"
              >
                <HashIcon className="size-3" aria-hidden="true" />
                <span className="truncate">{shortRunId}</span>
              </Badge>
            )}
          />
          <TooltipContent sideOffset={6}>
            {meta.runId ?? 'Run has not been assigned yet'}
          </TooltipContent>
        </Tooltip>
        <MetricBadge icon={<ActivityIcon className="size-3" aria-hidden="true" />} label="TTFB" value={ttfbMs} />
        <MetricBadge icon={<TimerIcon className="size-3" aria-hidden="true" />} label="TTFT" value={ttftMs} />
        {totalMs !== null && (
          <MetricBadge icon={<CheckIcon className="size-3" aria-hidden="true" />} label="Done" value={totalMs} />
        )}
      </div>
    </TooltipProvider>
  )
}

function MetricBadge({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
}) {
  return (
    <Badge
      variant="ghost"
      className="h-5 gap-1 px-1.5 font-normal text-[10px] text-muted-foreground/80 tabular-nums"
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono">{value === null ? '…' : formatDuration(value)}</span>
    </Badge>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

function ThinkingPlaceholder() {
  const { t } = useTranslation('chat')

  return (
    <div
      data-testid="message-bubble-thinking-placeholder"
      className="mt-3 flex h-6 w-full items-center overflow-hidden text-xs text-muted-foreground/70"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-flex items-center font-medium',
          '[mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [mask-size:220%_100%]',
          '[-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [-webkit-mask-size:220%_100%]',
          'animate-[shimmer_2.8s_linear_infinite]',
        )}
      >
        {t('status.thinking')}
      </span>
    </div>
  )
}

function useTextStreamIdle(enabled: boolean, textLength: number): boolean {
  const streamKey = enabled ? textLength : null
  const [idleStreamKey, setIdleStreamKey] = useState<number | null>(null)

  useEffect(() => {
    if (streamKey === null) {
      return
    }

    const timer = window.setTimeout(() => {
      setIdleStreamKey(streamKey)
    }, THINKING_IDLE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [streamKey])

  return streamKey !== null && idleStreamKey === streamKey
}

function hasActiveNonTextProgress(items: ChatRenderItem[]): boolean {
  return items.some((item) => {
    if (item.kind === 'reasoning') {
      return item.state === 'streaming'
    }
    if (item.kind === 'tool-call') {
      return isToolCallActive(item.toolCallId)
    }
    if (item.kind === 'tool-group') {
      return item.items.some(toolItem => isToolCallActive(toolItem.toolCallId))
    }
    return false
  })
}

function isToolCallActive(toolCallId: string): boolean {
  const state = useChatStore.getState().toolEntitiesMap.get(toolCallId)?.state
  return typeof state === 'string' && ACTIVE_TOOL_STATES.has(state)
}

function hasActiveNonTextSegmentProgress(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  segments: ChatRenderSegment[],
): boolean {
  return segments.some((segment) => {
    if (segment.kind === 'reasoning') {
      const part = readMessageFromState(state, sessionId, messageId)?.parts[segment.partIndex]
      return part?.type === 'reasoning' && (part as { state?: 'streaming' | 'done' }).state === 'streaming'
    }
    if (segment.kind === 'tool-call') {
      return isToolCallActiveInState(state, segment.toolCallId)
    }
    if (segment.kind === 'tool-group') {
      return segment.items.some(toolItem => isToolCallActiveInState(state, toolItem.toolCallId))
    }
    return false
  })
}

function isToolCallActiveInState(state: ChatStoreSnapshot, toolCallId: string): boolean {
  const toolState = state.toolEntitiesMap.get(toolCallId)?.state
  return typeof toolState === 'string' && ACTIVE_TOOL_STATES.has(toolState)
}

/* ─── Subagent part render ──────────────────────────────────────── */

function renderSubagentItem(
  item: ChatRenderItem,
  isStreaming: boolean,
  streamdownSettings: { animationPreset: string, animateMode: 'char' | 'word', showCursor: boolean },
) {
  switch (item.kind) {
    case 'text':
      return (
        <Streamdown
          key={item.key}
          content={item.text}
          streaming={isStreaming}
          animationPreset={streamdownSettings.animationPreset as 'minimal' | 'balanced' | 'dramatic'}
          animateMode={streamdownSettings.animateMode}
          showCursor={streamdownSettings.showCursor}
          animated={item.text.length <= SUBAGENT_STREAMING_ANIMATION_MAX_CHARS}
        />
      )
    case 'reasoning':
      return <ReasoningBlock key={item.key} text={item.text} state={item.state} />
    case 'tool-call': {
      return (
        <ToolCallBlockFromStore key={item.key} toolCallId={item.toolCallId} animated={false} />
      )
    }
    case 'tool-group':
      return <GroupedToolCallBlockFromStore key={item.key} items={item.items} uiKind={item.uiKind} animated={false} />
    case 'file-attachment':
      return <FileAttachmentBlock key={item.key} part={item.part} />
    case 'skill-context':
      return <SkillContextBlock key={item.key} part={item.part} />
    default:
      return null
  }
}

function groupSubagentMessageParts(messageId: string, parts: UIMessage['parts']) {
  return groupMessageParts({
    parts,
    messageId,
    describeToolKind: (toolCallId) => {
      const tool = useChatStore.getState().toolEntitiesMap.get(toolCallId)
      if (!tool) {
        return null
      }
      return describeToolCall({
        type: 'dynamic-tool',
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        state: tool.state,
        argumentsText: tool.argumentsText,
        input: tool.input,
        output: tool.output,
        errorText: tool.errorText,
      }).kind
    },
  })
}

function SubagentMessageContent({
  message,
  isStreaming,
  animationPreset,
  animateMode,
  showCursor,
}: {
  message: UIMessage
  isStreaming: boolean
  animationPreset: string
  animateMode: 'char' | 'word'
  showCursor: boolean
}) {
  const groupedParts = groupSubagentMessageParts(message.id, message.parts)
  const streamdownSettings = {
    animationPreset,
    animateMode,
    showCursor,
  }

  return groupedParts.map(groupedItem => renderSubagentItem(groupedItem, isStreaming, streamdownSettings))
}

/* ─── Execution Phase Fold ──────────────────────────────────────── */

function ExecutionPhaseFold({
  children,
  defaultOpen = false,
}: {
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultOpen)

  return (
    <div className="my-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setExpanded(v => !v)}
        className="h-6 px-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
      >
        {expanded ? 'Hide execution details' : 'Show execution details'}
      </Button>
      {expanded && (
        <div className="overflow-hidden -mx-3 px-3">
          <div className="mt-1 space-y-1">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main Component ────────────────────────────────────────────── */

const SEEN_MESSAGE_IDS_MAX = 1000
const seenMessageIds = new Set<string>()
function trackSeenMessageId(id: string): boolean {
  if (seenMessageIds.has(id)) {
    return false
  }
  if (seenMessageIds.size >= SEEN_MESSAGE_IDS_MAX) {
    const first = seenMessageIds.values().next().value
    if (first !== undefined) {
      seenMessageIds.delete(first)
    }
  }
  seenMessageIds.add(id)
  return true
}
const EMPTY_RENDER_SEGMENTS: ChatRenderSegment[] = []

interface MessageBubbleProps {
  message: UIMessage
  isStreaming: boolean
  executionDetailsDefaultOpen?: boolean
  presentation?: 'thread' | 'export'
  onToolApprovalResponse?: (response: {
    messageId: string
    approvalId: string
    approved: boolean
  }) => void
  onSetGoalFromMessage?: (messageId: string, text: string) => void
}

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>

interface MessageFrame {
  id: string
  role: UIMessage['role']
  isSteerMessage: boolean
}

function readMessageFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string): UIMessage | undefined {
  return (state.messagesMap.get(sessionId) ?? []).find(message => message.id === messageId)
}

function readMessageFrameFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string): MessageFrame | null {
  const message = readMessageFromState(state, sessionId, messageId)
  if (!message) {
    return null
  }
  const continuationMetadata = readChatContinuationMetadata(message)
  return {
    id: message.id,
    role: message.role,
    isSteerMessage: message.role === 'user' && continuationMetadata?.mode === 'steer',
  }
}

function areMessageFramesEqual(left: MessageFrame | null, right: MessageFrame | null): boolean {
  return left?.id === right?.id
    && left?.role === right?.role
    && left?.isSteerMessage === right?.isSteerMessage
}

function describeToolKindFromState(state: ChatStoreSnapshot, toolCallId: string) {
  const tool = state.toolEntitiesMap.get(toolCallId)
  if (!tool) {
    return null
  }
  return describeToolCall({
    type: 'dynamic-tool',
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    state: tool.state,
    argumentsText: tool.argumentsText,
    input: tool.input,
    output: tool.output,
    errorText: tool.errorText,
  }).kind
}

function readRenderSegmentsFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string): ChatRenderSegment[] {
  const message = readMessageFromState(state, sessionId, messageId)
  if (!message) {
    return EMPTY_RENDER_SEGMENTS
  }
  return groupMessagePartRefs({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: toolCallId => describeToolKindFromState(state, toolCallId),
  })
}

function areRenderSegmentsEqual(left: ChatRenderSegment[], right: ChatRenderSegment[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (!areRenderSegmentEqual(left[i], right[i])) {
      return false
    }
  }
  return true
}

function areRenderSegmentEqual(left: ChatRenderSegment, right: ChatRenderSegment): boolean {
  if (left.kind !== right.kind || left.key !== right.key) {
    return false
  }
  switch (left.kind) {
    case 'text':
      return right.kind === 'text'
        && left.messageId === right.messageId
        && left.partIndex === right.partIndex
        && left.hasText === right.hasText
    case 'reasoning':
    case 'file-attachment':
    case 'skill-context':
      return (right.kind === 'reasoning' || right.kind === 'file-attachment' || right.kind === 'skill-context')
        && left.kind === right.kind
        && left.messageId === right.messageId
        && left.partIndex === right.partIndex
    case 'tool-call':
      return right.kind === 'tool-call'
        && left.messageId === right.messageId
        && left.toolCallId === right.toolCallId
    case 'tool-group':
      return right.kind === 'tool-group'
        && left.uiKind === right.uiKind
        && areToolItemRefsEqual(left.items, right.items)
    default:
      return false
  }
}

function areToolItemRefsEqual(left: Array<{ key: string, messageId: string, toolCallId: string }>, right: Array<{ key: string, messageId: string, toolCallId: string }>): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (
      left[i].key !== right[i].key
      || left[i].messageId !== right[i].messageId
      || left[i].toolCallId !== right[i].toolCallId
    ) {
      return false
    }
  }
  return true
}

function readTextPartFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string, partIndex: number): string {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return part?.type === 'text' ? part.text : ''
}

function readReasoningPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): { text: string, state?: 'streaming' | 'done' } {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  if (part?.type !== 'reasoning') {
    return { text: '', state: 'done' }
  }
  return {
    text: part.text,
    state: (part as { state?: 'streaming' | 'done' }).state,
  }
}

function areReasoningPartsEqual(
  left: { text: string, state?: 'streaming' | 'done' },
  right: { text: string, state?: 'streaming' | 'done' },
): boolean {
  return left.text === right.text && left.state === right.state
}

function readFilePartFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string, partIndex: number): FileMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return part?.type === 'file' ? part : null
}

function readSkillContextPartFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string, partIndex: number): ChatSkillContextPart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatSkillContextPart(part) ? part : null
}

function readPlainTextFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string): string {
  const message = readMessageFromState(state, sessionId, messageId)
  if (!message) {
    return ''
  }
  return message.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('\n')
}

function readPlainTextPresenceFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string): boolean {
  const message = readMessageFromState(state, sessionId, messageId)
  return message?.parts.some(part => part.type === 'text' && part.text.length > 0) ?? false
}

function readPlainTextLengthFromState(state: ChatStoreSnapshot, sessionId: string, messageId: string): number {
  const message = readMessageFromState(state, sessionId, messageId)
  if (!message) {
    return 0
  }
  return message.parts.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0)
}

function readActiveStreamingSegmentKey(segments: ChatRenderSegment[]): string | null {
  const tail = segments.at(-1)
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'reasoning')) {
    return null
  }
  return tail.key
}

function ToolCallBlockFromStore({
  toolCallId,
  onToolApprovalResponse,
  children,
  animated,
}: {
  toolCallId: string
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  children?: React.ReactNode
  animated?: boolean
}) {
  const tool = useChatStore(chatSelectors.toolEntity(toolCallId))
  const { animationPreset, animateMode, showCursor } = useStreamdownStore()
  if (!tool) {
    return null
  }

  const subagentMessage = readSubagentOutputMessage(tool.output)

  return (
    <ToolCallBlock
      toolName={tool.toolName}
      toolCallId={tool.toolCallId}
      state={tool.state}
      approval={tool.approval}
      argumentsText={tool.argumentsText}
      input={tool.input}
      output={tool.output}
      errorText={tool.errorText}
      animated={animated}
      onApprovalResponse={tool.approval && onToolApprovalResponse
        ? approval => onToolApprovalResponse({
            messageId: tool.messageId,
            approvalId: approval.id,
            approved: approval.approved,
          })
        : undefined}
    >
      {subagentMessage
        ? (
            <SubagentMessageContent
              message={subagentMessage}
              isStreaming={tool.preliminary === true}
              animationPreset={animationPreset}
              animateMode={animateMode}
              showCursor={showCursor}
            />
          )
        : null}
      {children}
    </ToolCallBlock>
  )
}

function GroupedToolCallBlockFromStore({
  items,
  uiKind,
  animated,
}: {
  items: Array<{ key: string, messageId: string, toolCallId: string }>
  uiKind: ReturnType<typeof describeToolCall>['kind']
  animated?: boolean
}) {
  const selectedToolState = useChatStore(useShallow(state =>
    items.map(item => state.toolEntitiesMap.get(item.toolCallId))))
  const tools = useMemo(() =>
    items.flatMap((item, index) => {
      const entity = selectedToolState[index] as ChatToolEntity | undefined
      if (!entity) {
        return []
      }
      return [{
        key: item.key,
        part: {
          type: 'dynamic-tool' as const,
          toolCallId: entity.toolCallId,
          toolName: entity.toolName,
          state: entity.state,
          argumentsText: entity.argumentsText,
          input: entity.input,
          output: entity.output,
          errorText: entity.errorText,
        },
      }]
    }), [items, selectedToolState])

  if (tools.length === 0) {
    return null
  }

  return <GroupedToolCallBlock items={tools} uiKind={uiKind} animated={animated} />
}

function MessageTextPartById({
  sessionId,
  messageId,
  partIndex,
  isUser,
  isActiveStreamingSegment,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  isUser: boolean
  isActiveStreamingSegment: boolean
}) {
  const text = useChatStore(state => readTextPartFromState(state, sessionId, messageId, partIndex))
  const { animationPreset, animateMode, showCursor } = useStreamdownStore()
  const animated = text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS

  if (isUser) {
    return <span className="whitespace-pre-wrap wrap-break-word">{text}</span>
  }

  return (
    <Streamdown
      content={text}
      streaming={isActiveStreamingSegment}
      animationPreset={animationPreset}
      animateMode={animateMode}
      showCursor={showCursor}
      animated={animated}
    />
  )
}

function MessageReasoningPartById({
  sessionId,
  messageId,
  partIndex,
  isActiveStreamingSegment,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  isActiveStreamingSegment: boolean
}) {
  const part = useChatStore(
    state => readReasoningPartFromState(state, sessionId, messageId, partIndex),
    areReasoningPartsEqual,
  )
  const state = isActiveStreamingSegment && part.state === 'streaming' ? 'streaming' : 'done'

  return <ReasoningBlock text={part.text} state={state} />
}

function MessageFilePartById({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) {
  const part = useChatStore(state => readFilePartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <FileAttachmentBlock part={part} />
}

function MessageSkillContextPartById({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) {
  const part = useChatStore(state => readSkillContextPartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <SkillContextBlock part={part} />
}

function MessageThinkingPlaceholderById({
  sessionId,
  messageId,
  isAssistant,
  isStreaming,
  segmentCount,
  segments,
}: {
  sessionId: string
  messageId: string
  isAssistant: boolean
  isStreaming: boolean
  segmentCount: number
  segments: ChatRenderSegment[]
}) {
  const textLength = useChatStore(state => readPlainTextLengthFromState(state, sessionId, messageId))
  const hasActiveProgress = useChatStore(
    state => hasActiveNonTextSegmentProgress(state, sessionId, messageId, segments),
  )
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, textLength)

  if (!isAssistant || !isStreaming || hasActiveProgress || (segmentCount !== 0 && !streamTextIdle)) {
    return null
  }

  return <ThinkingPlaceholder />
}

function MessageCopyActionById({
  sessionId,
  messageId,
  isUser,
  onSetGoalFromMessage,
}: {
  sessionId: string
  messageId: string
  isUser: boolean
  onSetGoalFromMessage?: MessageBubbleProps['onSetGoalFromMessage']
}) {
  const hasPlainText = useChatStore(state => readPlainTextPresenceFromState(state, sessionId, messageId))
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    const plainText = readPlainTextFromState(useChatStore.getState(), sessionId, messageId)
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }, [messageId, sessionId])

  const handleSetGoal = useCallback(() => {
    const plainText = readPlainTextFromState(useChatStore.getState(), sessionId, messageId).trim()
    if (!plainText) {
      return
    }
    onSetGoalFromMessage?.(messageId, plainText)
  }, [messageId, onSetGoalFromMessage, sessionId])

  if (!hasPlainText) {
    return null
  }

  return (
    <div className={cn(
      'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
      isUser && 'justify-end',
    )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        className="text-muted-foreground/50 hover:text-foreground"
        aria-label="Copy message"
      >
        {copied
          ? <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
          : <CopyIcon className="size-3.5" aria-hidden="true" />}
      </Button>
      {isUser && onSetGoalFromMessage && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleSetGoal}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Set message as goal"
        >
          <TargetIcon className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

function MessageSegmentView({
  segment,
  sessionId,
  isUser,
  isActiveStreamingSegment,
  onToolApprovalResponse,
}: {
  segment: ChatRenderSegment
  sessionId: string
  isUser: boolean
  isActiveStreamingSegment: boolean
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
}) {
  switch (segment.kind) {
    case 'text':
      return (
        <MessageTextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          isUser={isUser}
          isActiveStreamingSegment={isActiveStreamingSegment}
        />
      )
    case 'reasoning':
      return (
        <MessageReasoningPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          isActiveStreamingSegment={isActiveStreamingSegment}
        />
      )
    case 'tool-group':
      return <GroupedToolCallBlockFromStore items={segment.items} uiKind={segment.uiKind} />
    case 'tool-call':
      return (
        <ToolCallBlockFromStore
          toolCallId={segment.toolCallId}
          onToolApprovalResponse={onToolApprovalResponse}
        />
      )
    case 'file-attachment':
      return (
        <MessageFilePartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    case 'skill-context':
      return (
        <MessageSkillContextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    default:
      return null
  }
}

function MessageBubbleSegmentsView({
  sessionId,
  frame,
  segments,
  isStreaming,
  onToolApprovalResponse,
  onSetGoalFromMessage,
}: {
  sessionId: string
  frame: MessageFrame
  segments: ChatRenderSegment[]
  isStreaming: boolean
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  onSetGoalFromMessage?: MessageBubbleProps['onSetGoalFromMessage']
}) {
  const isUser = frame.role === 'user'
  const isAssistant = frame.role === 'assistant'
  const { t } = useTranslation('chat')
  const isFirstAppearance = trackSeenMessageId(frame.id)
  const activeStreamingSegmentKey = isStreaming ? readActiveStreamingSegmentKey(segments) : null
  const executionPhaseSplit = useMemo(
    () => isStreaming ? null : splitSegmentExecutionPhase(segments),
    [segments, isStreaming],
  )

  function renderSegment(segment: ChatRenderSegment) {
    return (
      <MessageSegmentView
        key={segment.key}
        segment={segment}
        sessionId={sessionId}
        isUser={isUser}
        isActiveStreamingSegment={segment.key === activeStreamingSegmentKey}
        onToolApprovalResponse={onToolApprovalResponse}
      />
    )
  }

  function renderContent() {
    if (!executionPhaseSplit) {
      return segments.map(renderSegment)
    }

    return (
      <>
        <ExecutionPhaseFold>
          {executionPhaseSplit.executionItems.map(renderSegment)}
        </ExecutionPhaseFold>
        {executionPhaseSplit.finalItems.map(renderSegment)}
      </>
    )
  }

  return (
    <m.div
      initial={isFirstAppearance ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={BUBBLE_TRANSITION}
      data-testid={`message-bubble-${frame.role}`}
      data-message-id={frame.id}
      data-message-role={frame.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn(
        'group flex w-full gap-3',
        isUser && 'justify-end',
      )}
    >
      <div
        className={cn(
          'min-w-0',
          isUser && !frame.isSteerMessage && 'max-w-[70%]',
          frame.isSteerMessage && 'max-w-[78%]',
          !isUser && 'w-full',
        )}
      >
        {frame.isSteerMessage && (
          <div className="mb-1 flex justify-end pr-1">
            <span className="text-[10px] font-medium uppercase text-muted-foreground/60">
              {t('continuation.steer.label')}
            </span>
          </div>
        )}
        <div
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser && !frame.isSteerMessage && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            frame.isSteerMessage && 'rounded-br-sm bg-transparent px-3 py-2 text-foreground/75 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.35)] backdrop-blur-[1px]',
            isAssistant && 'text-foreground',
          )}
        >
          {renderContent()}
          <MessageThinkingPlaceholderById
            sessionId={sessionId}
            messageId={frame.id}
            isAssistant={isAssistant}
            isStreaming={isStreaming}
            segmentCount={segments.length}
            segments={segments}
          />
        </div>

        {isAssistant && <RunDebugCaption messageId={frame.id} />}

        {!isStreaming && (
          <MessageCopyActionById
            sessionId={sessionId}
            messageId={frame.id}
            isUser={isUser}
            onSetGoalFromMessage={onSetGoalFromMessage}
          />
        )}
      </div>
    </m.div>
  )
}

export function MessageBubbleById({
  sessionId,
  messageId,
  onToolApprovalResponse,
  onSetGoalFromMessage,
}: {
  sessionId: string | null
  messageId: string
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  onSetGoalFromMessage?: MessageBubbleProps['onSetGoalFromMessage']
}) {
  const storeSessionId = sessionId ?? ''
  const frame = useChatStore(
    state => readMessageFrameFromState(state, storeSessionId, messageId),
    areMessageFramesEqual,
  )
  const segments = useChatStore(
    state => readRenderSegmentsFromState(state, storeSessionId, messageId),
    areRenderSegmentsEqual,
  )
  const isStreaming = useChatStore(chatSelectors.isStreamingMessage(messageId))

  if (!frame) {
    return null
  }

  return (
    <MessageBubbleSegmentsView
      sessionId={storeSessionId}
      frame={frame}
      segments={segments}
      isStreaming={isStreaming}
      onToolApprovalResponse={onToolApprovalResponse}
      onSetGoalFromMessage={onSetGoalFromMessage}
    />
  )
}

function MessageBubbleView({ message, isStreaming, executionDetailsDefaultOpen = false, presentation = 'thread', onToolApprovalResponse, onSetGoalFromMessage }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isExportPresentation = presentation === 'export'
  const continuationMetadata = readChatContinuationMetadata(message)
  const isSteerMessage = isUser && continuationMetadata?.mode === 'steer'
  const { t } = useTranslation('chat')
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const { animationPreset, animateMode, showCursor } = useStreamdownStore()

  const isFirstAppearance = trackSeenMessageId(message.id)

  const plainText = useMemo(() => {
    return message.parts
      .flatMap(p => p.type === 'text' ? [(p as { text: string }).text] : [])
      .join('\n')
  }, [message.parts])
  const plainTextLength = useMemo(() => {
    return message.parts.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0)
  }, [message.parts])
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, plainTextLength)

  const groupedItems = useMemo(
    () => groupMessageParts({
      parts: message.parts,
      messageId: message.id,
      describeToolKind: (toolCallId) => {
        const tool = useChatStore.getState().toolEntitiesMap.get(toolCallId)
        if (!tool) {
          return null
        }
        return describeToolCall({
          type: 'dynamic-tool',
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          state: tool.state,
          argumentsText: tool.argumentsText,
          input: tool.input,
          output: tool.output,
          errorText: tool.errorText,
        }).kind
      },
    }),
    [message.parts, message.id],
  )

  const executionPhaseSplit = useMemo(
    () => isStreaming ? null : splitExecutionPhase(groupedItems),
    [groupedItems, isStreaming],
  )
  const hasActiveProgress = hasActiveNonTextProgress(groupedItems)
  const showThinkingPlaceholder = isAssistant
    && isStreaming
    && !hasActiveProgress
    && (groupedItems.length === 0 || streamTextIdle)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }, [plainText])

  const handleSetGoal = useCallback(() => {
    const text = plainText.trim()
    if (!text) {
      return
    }
    onSetGoalFromMessage?.(message.id, text)
  }, [message.id, onSetGoalFromMessage, plainText])

  /* ─── Render items ─── */
  function renderItem(item: ChatRenderItem) {
    switch (item.kind) {
      case 'text':
        if (isUser) {
          return (
            <span key={item.key} className="whitespace-pre-wrap wrap-break-word">
              {item.text}
            </span>
          )
        }
        return (
          <Streamdown
            key={item.key}
            content={item.text}
            streaming={isStreaming}
            animationPreset={animationPreset}
            animateMode={animateMode}
            showCursor={showCursor}
            animated={item.text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS}
          />
        )

      case 'reasoning':
        return <ReasoningBlock key={item.key} text={item.text} state={item.state} />

      case 'tool-group':
        return <GroupedToolCallBlockFromStore key={item.key} items={item.items} uiKind={item.uiKind} />

      case 'tool-call':
        return (
          <ToolCallBlockFromStore
            key={item.key}
            toolCallId={item.toolCallId}
            onToolApprovalResponse={onToolApprovalResponse}
          />
        )

      case 'file-attachment':
        return <FileAttachmentBlock key={item.key} part={item.part} />

      default:
        return null
    }
  }

  /* ─── Separate execution-phase items from final reply ─── */
  function renderContent() {
    if (!executionPhaseSplit) {
      return groupedItems.map(renderItem)
    }

    if (isExportPresentation) {
      return executionPhaseSplit.finalItems.map(renderItem)
    }

    return (
      <>
        <ExecutionPhaseFold defaultOpen={executionDetailsDefaultOpen}>
          {executionPhaseSplit.executionItems.map(renderItem)}
        </ExecutionPhaseFold>
        {executionPhaseSplit.finalItems.map(renderItem)}
      </>
    )
  }

  return (
    <m.div
      initial={!isExportPresentation && isFirstAppearance ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={BUBBLE_TRANSITION}
      data-testid={`message-bubble-${message.role}`}
      data-message-id={message.id}
      data-message-role={message.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn(
        'group flex w-full gap-3',
        isUser && 'justify-end',
      )}
    >
      <div
        className={cn(
          'min-w-0',
          isUser && !isSteerMessage && 'max-w-[70%]',
          isSteerMessage && 'max-w-[78%]',
          !isUser && 'w-full',
        )}
      >
        {isSteerMessage && (
          <div className="mb-1 flex justify-end pr-1">
            <span className="text-[10px] font-medium uppercase text-muted-foreground/60">
              {t('continuation.steer.label')}
            </span>
          </div>
        )}
        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser && !isSteerMessage && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            isSteerMessage && 'rounded-br-sm bg-transparent px-3 py-2 text-foreground/75 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.35)] backdrop-blur-[1px]',
            isAssistant && 'text-foreground',
          )}
        >
          {renderContent()}
          {showThinkingPlaceholder && <ThinkingPlaceholder />}
        </div>

        {isAssistant && <RunDebugCaption messageId={message.id} />}

        {/* Action bar — appears on hover for all messages */}
        {!isExportPresentation && !isStreaming && plainText.length > 0 && (
          <div className={cn(
            'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
            isUser && 'justify-end',
          )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-foreground"
              aria-label="Copy message"
            >
              {copied
                ? <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
                : <CopyIcon className="size-3.5" aria-hidden="true" />}
            </Button>
            {isUser && onSetGoalFromMessage && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={handleSetGoal}
                className="text-muted-foreground/50 hover:text-foreground"
                aria-label="Set message as goal"
              >
                <TargetIcon className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>
    </m.div>
  )
}

export const MessageBubble = memo(
  MessageBubbleView,
  (prevProps, nextProps) =>
    (prevProps.message === nextProps.message || isEqual(prevProps.message, nextProps.message))
    && prevProps.isStreaming === nextProps.isStreaming
    && prevProps.executionDetailsDefaultOpen === nextProps.executionDetailsDefaultOpen
    && prevProps.presentation === nextProps.presentation
    && prevProps.onToolApprovalResponse === nextProps.onToolApprovalResponse
    && prevProps.onSetGoalFromMessage === nextProps.onSetGoalFromMessage,
)
