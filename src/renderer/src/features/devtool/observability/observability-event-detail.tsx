// Input: useObservabilityDevtoolStore state/actions
// Output: ObservabilityEventDetail panel with payload inspection and export controls
// Position: Renderer detail component for the observability devtool pane

import { useMemo, useState } from 'react'

import { useObservabilityDevtoolStore } from './use-observability-events'

export function ObservabilityEventDetail() {
  const events = useObservabilityDevtoolStore(s => s.events)
  const selectedIndex = useObservabilityDevtoolStore(s => s.selectedIndex)
  const clear = useObservabilityDevtoolStore(s => s.clear)
  const flush = useObservabilityDevtoolStore(s => s.flush)
  const exportBundle = useObservabilityDevtoolStore(s => s.exportBundle)
  const [exportText, setExportText] = useState<string | null>(null)

  const entry = useMemo(
    () => (selectedIndex === null ? null : events[selectedIndex] ?? null),
    [events, selectedIndex],
  )

  return (
    <div className="h-full overflow-auto p-3 font-mono text-[11px]">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => clear()}
          className="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => { void flush() }}
          className="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
        >
          Flush
        </button>
        <button
          type="button"
          onClick={() => {
            void exportBundle({
              chatSessionId: entry?.payload.chatSessionId,
              runId: entry?.payload.runId,
            }).then(setExportText)
          }}
          className="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
        >
          Export
        </button>
      </div>

      {!entry && (
        <div className="text-xs text-muted-foreground/50">
          Select an event to inspect
        </div>
      )}

      {entry && (
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[10px] text-muted-foreground">Selected Payload</div>
            <pre className="whitespace-pre-wrap wrap-break-word text-foreground/80">
              {JSON.stringify(entry, null, 2)}
            </pre>
          </div>
          {exportText && (
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">Export Bundle</div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap wrap-break-word text-foreground/80">
                {exportText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

