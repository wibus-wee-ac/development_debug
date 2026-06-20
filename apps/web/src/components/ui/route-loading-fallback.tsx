import { LoadingLine as LoaderCircleIcon } from '~/components/ui/mingcute-icons'
export function RouteLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground/40" />
    </div>
  )
}
