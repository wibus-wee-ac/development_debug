// Input: shared ipc proxy for calling dev/ipcDevtool namespaces, lucide icons, window.location
// Output: DevBottomBar — dev-only slim footer with open-userData, hard-reload, IPC devtool, and current URL display
// Position: Bottom chrome of AppLayout, rendered only in dev mode

import { ipc } from '@renderer/lib/ipc'
import { FolderOpenIcon, NetworkIcon, RefreshCwIcon } from 'lucide-react'

export function DevBottomBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-border bg-sidebar/50 px-2 font-mono text-[10px]">
      <span
        className="flex-1 truncate select-all text-muted-foreground/70"
        title={window.location.href}
      >
        {window.location.hash || '/'}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Open userData folder"
          aria-label="Open userData folder"
          onClick={() => {
            void ipc?.dev.openUserData()
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <FolderOpenIcon className="inline-block size-3.5" aria-hidden="true" />
          Open userData
        </button>
        <button
          type="button"
          title="Hard reload (ignore cache)"
          aria-label="Hard reload"
          onClick={() => {
            void ipc?.dev.hardReload()
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <RefreshCwIcon className="inline-block size-3.5" aria-hidden="true" />
          Hard Reload
        </button>
        <button
          type="button"
          title="Open IPC Devtool"
          aria-label="Open IPC Devtool"
          onClick={() => {
            void ipc?.ipcDevtool.openWindow()
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <NetworkIcon className="inline-block size-3.5" aria-hidden="true" />
          IPC Devtool
        </button>
      </div>
    </footer>
  )
}
