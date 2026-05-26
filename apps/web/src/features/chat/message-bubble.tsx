import { Streamdown } from '@cradle/streamdown'
import type { UIMessage } from 'ai'
import { ActivityIcon, CheckIcon, CopyIcon, FileIcon, HashIcon, ImageIcon, TimerIcon } from 'lucide-react'
import { m } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { ChatRenderItem, FileMessagePart } from './chat-render-plan'
import { groupMessageParts, splitExecutionPhase } from './chat-render-plan'
import type { ChatToolEntity } from './chat-tool-entities'
import { describeToolCall } from './tool-ui-classifier'

const BUBBLE_TRANSITION = { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } as const
const IS_DEV = import.meta.env.DEV
const EMPTY_SUBAGENT_MESSAGES: UIMessage[] = []

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
        />
      )
    case 'reasoning':
      return <ReasoningBlock key={item.key} text={item.text} state={item.state} />
    case 'tool-call': {
      return (
        <ToolCallBlockFromStore key={item.key} toolCallId={item.toolCallId} />
      )
    }
    case 'tool-group':
      return <GroupedToolCallBlockFromStore key={item.key} items={item.items} uiKind={item.uiKind} />
    case 'file-attachment':
      return <FileAttachmentBlock key={item.key} part={item.part} />
    default:
      return null
  }
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

const seenMessageIds = new Set<string>()

interface MessageBubbleProps {
  message: UIMessage
  isStreaming: boolean
  executionDetailsDefaultOpen?: boolean
}

function ToolCallBlockFromStore({
  toolCallId,
  children,
}: {
  toolCallId: string
  children?: React.ReactNode
}) {
  const tool = useChatStore(chatSelectors.toolEntity(toolCallId))
  if (!tool) {
    return null
  }

  return (
    <ToolCallBlock
      toolName={tool.toolName}
      toolCallId={tool.toolCallId}
      state={tool.state}
      argumentsText={tool.argumentsText}
      input={tool.input}
      output={tool.output}
      errorText={tool.errorText}
    >
      {children}
    </ToolCallBlock>
  )
}

function GroupedToolCallBlockFromStore({
  items,
  uiKind,
}: {
  items: Array<{ key: string, messageId: string, toolCallId: string }>
  uiKind: ReturnType<typeof describeToolCall>['kind']
}) {
  const selectedToolState = useChatStore(useShallow(state =>
    items.flatMap(item => [
      state.toolEntitiesMap.get(item.toolCallId),
      state.subagentMessagesMap.get(item.messageId)?.get(item.toolCallId) ?? EMPTY_SUBAGENT_MESSAGES,
    ])))
  const tools = useMemo(() =>
    items.flatMap((item, index) => {
      const entity = selectedToolState[index * 2] as ChatToolEntity | undefined
      if (!entity) {
        return []
      }
      const subagentMessages = selectedToolState[index * 2 + 1] as UIMessage[]
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
        subagentMessages,
      }]
    }), [items, selectedToolState])

  if (tools.length === 0) {
    return null
  }

  return <GroupedToolCallBlock items={tools} uiKind={uiKind} />
}

function MessageBubbleView({ message, isStreaming, executionDetailsDefaultOpen = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const { animationPreset, animateMode, showCursor } = useStreamdownStore()
  const subagentMap = useChatStore(s => s.subagentMessagesMap.get(message.id))

  const isFirstAppearance = !seenMessageIds.has(message.id)
  if (isFirstAppearance) {
    seenMessageIds.add(message.id)
  }

  const plainText = useMemo(() => {
    return message.parts
      .flatMap(p => p.type === 'text' ? [(p as { text: string }).text] : [])
      .join('\n')
  }, [message.parts])

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
          >
            {(subagentMap?.get(item.toolCallId) ?? []).flatMap((subMsg) => {
              const groupedParts = groupMessageParts({
                parts: subMsg.parts,
                messageId: subMsg.id,
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
              return groupedParts.map(groupedItem => renderSubagentItem(groupedItem, isStreaming, { animationPreset, animateMode, showCursor }))
            })}
          </ToolCallBlockFromStore>
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
      initial={isFirstAppearance ? { opacity: 0, y: 8 } : false}
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
          isUser && 'max-w-[70%] ',
          !isUser && 'w-full',
        )}
      >
        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            isAssistant && 'text-foreground',
          )}
        >
          {renderContent()}
        </div>

        {isAssistant && <RunDebugCaption messageId={message.id} />}

        {/* Action bar — appears on hover for all messages */}
        {!isStreaming && plainText.length > 0 && (
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
          </div>
        )}
      </div>
    </m.div>
  )
}

export const MessageBubble = memo(
  MessageBubbleView,
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message
    && prevProps.isStreaming === nextProps.isStreaming
    && prevProps.executionDetailsDefaultOpen === nextProps.executionDetailsDefaultOpen,
)
