/* Quick capture: textarea + submit. Cmd/Ctrl+Enter submits. Toasts on success
   or failure. Calls POST /memories with `{ content }` (plugin server injects
   space_id if needed). */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { SendPlaneLine as SendIcon } from '@mingcute/react'
import { useCallback, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import { useCreateMemory } from '../hooks'

interface QuickCaptureProps {
  ctx: WebPluginContext
  onCreated?: () => void
}

export function QuickCapture({ ctx, onCreated }: QuickCaptureProps) {
  const { mutate, pending } = useCreateMemory(ctx.routes)
  const [content, setContent] = useState('')

  const submit = useCallback(async () => {
    const trimmed = content.trim()
    if (!trimmed || pending) { return }
    try {
      await mutate(trimmed)
      ctx.notifications.show({
        title: 'Memory saved',
        description: 'Added to durable memory.',
        type: 'success',
      })
      setContent('')
      onCreated?.()
    }
    catch {
      // hook surfaces error; notification already shown by callers via state
    }
  }, [content, ctx.notifications, mutate, onCreated, pending])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }, [submit])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Quick capture</span>
        <span className="text-[10.5px] text-muted-foreground">⌘↵ to save</span>
      </div>
      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Capture a fact, decision, or learning…"
        className={cn('min-h-[64px] resize-none text-[13px]', pending && 'opacity-60')}
        disabled={pending}
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{content.length} chars</span>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={!content.trim() || pending}
        >
          <SendIcon className="size-3.5" aria-hidden="true" />
          {pending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
