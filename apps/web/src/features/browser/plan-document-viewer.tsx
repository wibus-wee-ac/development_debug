import { StaticRender } from '@cradle/streamdown'
import { PanelTopIcon } from 'lucide-react'

import { ScrollArea } from '~/components/ui/scroll-area'

interface PlanDocumentViewerProps {
  title: string
  text: string
}

export function PlanDocumentViewer({ title, text }: PlanDocumentViewerProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <PanelTopIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{title}</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="streamdown-root px-5 py-4 text-sm leading-relaxed">
          <StaticRender content={text} />
        </div>
      </ScrollArea>
    </div>
  )
}
