// Input: lucide-react Loader2Icon
// Output: RouteLoadingFallback — minimal spinner for lazy route pending states
// Position: Shared UI component used as pendingComponent in lazy routes

import { LoaderCircleIcon } from 'lucide-react'

export function RouteLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground/40" />
    </div>
  )
}
