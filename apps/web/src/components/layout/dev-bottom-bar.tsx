// Input: lucide icons, window.location
// Output: DevBottomBar — dev-only slim footer with hard-reload and current URL display
// Position: Bottom chrome of AppLayout, rendered only in dev mode

import { RefreshCwIcon } from 'lucide-react'

export function DevBottomBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-border bg-sidebar px-2 font-mono text-[10px]">
      <span
        className="flex-1 truncate select-all text-muted-foreground"
        title={window.location.href}
      >
        {window.location.hash || '/'}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Hard reload (ignore cache)"
          aria-label="Hard reload"
          onClick={() => {
            window.location.reload()
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <RefreshCwIcon className="inline-block size-3.5" aria-hidden="true" />
          Hard Reload
        </button>
      </div>
    </footer>
  )
}
