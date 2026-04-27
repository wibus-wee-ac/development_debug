// Input: Button, cn utility
// Output: AppFooter — slim global status footer bar mirroring the AppHeader chrome pattern
// Position: Bottom chrome of AppLayout's center column; always rendered, no slot props

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/cn'
import { MousePointer2Icon } from 'lucide-react'

export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        'flex h-9 shrink-0 items-center bg-sidebar px-1',
        className,
      )}
    >
      <div className="flex-1" />
      <div className="flex items-center gap-2 mx-2">
        <Button variant="ghost" size="xs" className="h-5 text-xs text-muted-foreground px-2 gap-2">
          <MousePointer2Icon />
          Ask Jarvis
        </Button>
      </div>
    </footer>
  )
}
