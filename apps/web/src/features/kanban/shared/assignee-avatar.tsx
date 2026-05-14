// Input: name string
// Output: Avatar circle with initial letter or fallback icon
// Position: Shared display component for assignee avatars

import { UserIcon } from 'lucide-react'

import { cn } from '~/lib/cn'

export function AssigneeAvatar({ name, size = 20, className }: {
  name?: string | null
  size?: number
  className?: string
}) {
  const initial = name?.charAt(0)?.toUpperCase()

  return (
    <div
      className={cn(
        'shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {initial
        ? <span className="text-[10px] font-medium">{initial}</span>
        : <UserIcon className="size-3" />}
    </div>
  )
}
