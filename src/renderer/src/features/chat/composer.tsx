// Input: MentionPanel, Button from UI, workspace file listing
// Output: Composer — rich input with @ path autocomplete and inline send/stop
// Position: Core input component for chat feature, used in both NewChatHome and ChatView

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { SendHorizonalIcon, SquareIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { MentionItem } from './mention-panel'
import { MentionPanel } from './mention-panel'

interface ComposerProps {
  onSend: (text: string) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  availableFiles?: MentionItem[]
  className?: string
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
}

export function Composer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder = '输入消息...',
  availableFiles = [],
  className,
  toolbar,
  contextBar,
}: ComposerProps) {
  const [inputValue, setInputValue] = useState('')
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Track @ trigger position for path completion
  const mentionStartRef = useRef<number>(-1)

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInputValue(value)
    autoResize(e.target)

    // Check for @ trigger
    const cursor = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const afterAt = textBefore.slice(atIdx + 1)
      // Show panel if typing after @ without newline
      if (!afterAt.includes('\n')) {
        setMentionActive(true)
        setMentionQuery(afterAt)
        mentionStartRef.current = atIdx
        return
      }
    }
    setMentionActive(false)
    setMentionQuery('')
  }, [])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    // Replace @query with @path (inline text completion)
    const start = mentionStartRef.current
    if (start < 0) {
      return
    }

    const before = inputValue.slice(0, start)
    const cursor = textareaRef.current?.selectionStart ?? inputValue.length
    const after = inputValue.slice(cursor)
    // Directories: no trailing space (user may continue typing sub-path)
    // Files: add trailing space for convenience
    const suffix = item.type === 'directory' ? '/' : ' '
    const insertText = `@${item.path}${suffix}`

    const newValue = `${before}${insertText}${after}`
    setInputValue(newValue)
    // Keep mention active for directories so user can keep navigating
    if (item.type === 'directory') {
      setMentionQuery(`${item.path}/`)
      mentionStartRef.current = start
    }
    else {
      setMentionActive(false)
      setMentionQuery('')
      mentionStartRef.current = -1
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
  }, [inputValue])

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text) {
      return
    }
    onSend(text)
    setInputValue('')
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = 'auto'
      }
    })
  }, [inputValue, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Don't interfere with IME composition (e.g. Chinese input)
    if (e.nativeEvent.isComposing) {
      return
    }

    // If mention panel is active, let it handle Enter/Escape/arrows
    if (mentionActive) {
      if (['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        return // MentionPanel handles these via document keydown
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [mentionActive, handleSend])

  // Close mention on blur after a short delay (to allow click selection)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const handleBlur = () => {
      timer = setTimeout(setMentionActive, 150, false)
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
        query={mentionQuery}
        onSelect={handleMentionSelect}
        onClose={() => setMentionActive(false)}
        visible={mentionActive}
      />

      {/* Input card — modern clean style, no border-t separator */}
      <div className="rounded-xl bg-background shadow-xs border border-border/40 focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring/40 transition-all">
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none min-h-16 max-h-60 rounded-t-xl disabled:opacity-50"
        />

        {/* Action bar — subtle, blends with the card */}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {/* Left: custom toolbar from parent */}
          <div className="flex items-center gap-1">
            {toolbar}
          </div>

          {/* Right: context bar + send/stop */}
          <div className="flex items-center gap-1">
            {contextBar}
            {isStreaming
              ? (
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={onStop}
                  aria-label="停止生成"
                >
                  <SquareIcon className="size-3" aria-hidden="true" />
                </Button>
              )
              : (
                <Button
                  variant="default"
                  size="icon-xs"
                  disabled={disabled || !inputValue.trim()}
                  onClick={handleSend}
                  aria-label="发送"
                >
                  <SendHorizonalIcon aria-hidden="true" />
                </Button>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
