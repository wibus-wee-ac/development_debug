import { WrenchIcon } from 'lucide-react'

import { cn } from '~/lib/utils'

import type { AgentActivity } from '~/lib/types'

interface AgentActivityItemProps {
  activity: AgentActivity
}

export function AgentActivityItem({ activity }: AgentActivityItemProps) {
  const base = 'py-1.5 px-3 text-[13px]'

  switch (activity.type) {
    case 'thought':
      return (
        <div className={cn(base, 'border-l-2 border-border/50 italic text-muted-foreground/60')}>
          {activity.content}
        </div>
      )

    case 'action':
      return (
        <div className={cn(base, 'flex items-start gap-2')}>
          <WrenchIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="font-mono text-[12px]">{activity.content}</span>
        </div>
      )

    case 'response':
      return (
        <div className={cn(base, 'border-l-2 border-green-500/50')}>
          {activity.content}
        </div>
      )

    case 'elicitation': {
      let options: string[] = []
      if (activity.signal === 'select' && activity.signalMetadata) {
        try {
          const meta = JSON.parse(activity.signalMetadata)
          if (Array.isArray(meta.options)) options = meta.options
        } catch { /* ignore */ }
      }
      return (
        <div className={cn(base, 'border-l-2 border-yellow-500/50')}>
          <p>{activity.content}</p>
          {options.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {options.map(opt => (
                <span key={opt} className="rounded bg-fill px-2 py-0.5 text-[12px] text-muted-foreground">
                  {opt}
                </span>
              ))}
            </div>
          )}
        </div>
      )
    }

    case 'error':
      return (
        <div className={cn(base, 'border-l-2 border-red-500/50 text-red-400')}>
          {activity.content}
        </div>
      )

    case 'prompt':
      return (
        <div className={cn(base, 'flex justify-end')}>
          <div className="max-w-[80%] rounded-lg bg-fill px-3 py-1.5 text-foreground">
            {activity.content}
          </div>
        </div>
      )

    default:
      return (
        <div className={cn(base, 'text-muted-foreground/60')}>
          {activity.content}
        </div>
      )
  }
}
