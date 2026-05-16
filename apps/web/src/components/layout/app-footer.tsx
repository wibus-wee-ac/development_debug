// Input: Button, cn utility, JarvisPopover
// Output: AppFooter — slim global status footer bar mirroring the AppHeader chrome pattern
// Position: Bottom chrome of AppLayout's center column; always rendered, no slot props

import * as React from 'react'
import { MousePointer2Icon } from 'lucide-react'

import { useLayoutGeometry } from '~/components/layout/layout-geometry-context'
import { Button } from '~/components/ui/button'
import { JarvisPopover } from '~/features/system-agent/jarvis-popover'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'

export function AppFooter({ className }: { className?: string }) {
  const [jarvisOpen, setJarvisOpen] = React.useState(false)
  const { registerFooter } = useLayoutGeometry()

  useShortcut('toggle-jarvis', { meta: true, key: 'j' }, () => setJarvisOpen(prev => !prev))

  return (
    <footer
      ref={registerFooter}
      className={cn(
        'relative flex h-9 shrink-0 items-center bg-sidebar px-1',
        className,
      )}
    >
      <div className="flex-1" />
      <div className="relative flex items-center gap-2 mx-2">
        <Button
          variant="ghost"
          size="xs"
          className="h-5 text-xs text-muted-foreground px-2 gap-2"
          onClick={() => setJarvisOpen(prev => !prev)}
          aria-expanded={jarvisOpen}
        >
          <MousePointer2Icon />
          Ask Jarvis
        </Button>
        <JarvisPopover open={jarvisOpen} onOpenChange={setJarvisOpen} />
      </div>
    </footer>
  )
}
