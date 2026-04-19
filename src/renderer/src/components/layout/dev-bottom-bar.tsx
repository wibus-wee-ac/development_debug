// Input: shared ipc proxy for calling dev/ipcDevtool namespaces, lucide icons
// Output: DevBottomBar — dev-only slim footer with open-userData, hard-reload, and IPC devtool buttons
// Position: Bottom chrome of AppLayout, rendered only in dev mode

import { ipc } from '@renderer/lib/ipc'
import { FolderOpenIcon, NetworkIcon, RefreshCwIcon } from 'lucide-react'

export function DevBottomBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-t border-border bg-sidebar px-2 font-mono text-[10px]">
      <button
        type="button"
        title="Open userData folder"
        aria-label="Open userData folder"
        onClick={() => {
          void ipc?.dev.openUserData()
        }}
        className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground flex items-center gap-1"
      >
        <FolderOpenIcon className="size-3.5 inline-block" aria-hidden="true" />
        Open userData
      </button>
      <button
        type="button"
        title="Hard reload (ignore cache)"
        aria-label="Hard reload"
        onClick={() => {
          void ipc?.dev.hardReload()
        }}
        className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground flex items-center gap-1"
      >
        <RefreshCwIcon className="size-3.5 inline-block" aria-hidden="true" />
        Hard Reload
      </button>
      <button
        type="button"
        title="Open IPC Devtool"
        aria-label="Open IPC Devtool"
        onClick={() => {
          void ipc?.ipcDevtool.openWindow()
        }}
        className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground flex items-center gap-1"
      >
        <NetworkIcon className="size-3.5 inline-block" aria-hidden="true" />
        IPC Devtool
      </button>
    </footer>
  )
}
