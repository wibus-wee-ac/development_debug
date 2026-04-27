// Input: @tanstack/react-table APIs, Zustand ipc-devtool stores, IpcTrace model, cn utility
// Output: IpcEventsTable — sortable, selectable table of IPC traces grouped by traceId
// Position: Left/main pane inside the IPC devtool page

import { cn } from '@renderer/lib/cn'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import { flowColor } from '../flow-color'
import type { IpcTrace } from './use-ipc-events'
import { useIpcDevtoolStore, useIpcFilteredTraces } from './use-ipc-events'

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`
}

const STATUS_STYLES: Record<IpcTrace['status'], string> = {
  pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  success: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  error: 'bg-rose-500/20 text-rose-700 dark:text-rose-400',
}

export function IpcEventsTable() {
  const traces = useIpcFilteredTraces()
  const selectedTraceId = useIpcDevtoolStore(s => s.selectedTraceId)
  const selectTrace = useIpcDevtoolStore(s => s.selectTrace)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'startedAt', desc: true }])

  const columns = useMemo<ColumnDef<IpcTrace>[]>(
    () => [
      {
        id: 'startedAt',
        accessorKey: 'startedAt',
        header: 'Time',
        size: 100,
        cell: ({ getValue }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatTime(getValue<number>())}
          </span>
        ),
      },
      {
        id: 'channel',
        accessorKey: 'channel',
        header: 'Channel',
        size: 260,
        cell: ({ row, getValue }) => {
          const color = flowColor(row.original.flowId)
          return (
            <span className="flex min-w-0 items-center gap-1.5 font-mono">
              {color
                ? (
                  <span
                    className={cn('h-2 w-2 shrink-0 rounded-full', color)}
                    title={`flow: ${row.original.flowId}`}
                    aria-hidden="true"
                  />
                )
                : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-transparent" aria-hidden="true" />
                )}
              <span className="truncate">{getValue<string>()}</span>
            </span>
          )
        },
      },
      {
        id: 'flow',
        header: 'Flow',
        size: 90,
        enableSorting: false,
        cell: ({ row }) => <FlowDots trace={row.original} />,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        size: 72,
        cell: ({ getValue }) => {
          const status = getValue<IpcTrace['status']>()
          return (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                STATUS_STYLES[status],
              )}
            >
              {status}
            </span>
          )
        },
      },
      {
        id: 'durationMs',
        accessorKey: 'durationMs',
        header: 'Duration',
        size: 80,
        cell: ({ row, getValue }) => {
          const ms = getValue<number | null>()
          if (ms === null) {
            return <span className="text-muted-foreground">…</span>
          }
          const color
            = row.original.status === 'error'
              ? 'text-rose-500'
              : ms > 100
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-muted-foreground'
          return (
            <span className={cn('block text-right tabular-nums', color)}>
              {ms}
              ms
            </span>
          )
        },
      },
      {
        id: 'preview',
        accessorFn: row => row.args?.summary ?? '',
        header: 'Args',
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="truncate text-muted-foreground">{getValue<string>()}</span>
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: traces,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="relative h-full overflow-auto font-mono text-[11px]">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const dir = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    className={cn(
                      'select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
                      canSort && 'cursor-pointer hover:text-foreground',
                    )}
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {dir === 'asc' ? ' ↑' : dir === 'desc' ? ' ↓' : ''}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const selected = row.original.traceId === selectedTraceId
            return (
              <tr
                key={row.id}
                data-ipc-trace-id={row.original.traceId}
                onClick={() => selectTrace(row.original.traceId)}
                className={cn(
                  'cursor-pointer hover:bg-muted/30',
                  selected && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                {row.getVisibleCells().map(cell => (
                  <td
                    key={cell.id}
                    className="truncate border-b border-border/40 px-2 py-1 align-middle"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
          {traces.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-muted-foreground"
              >
                No IPC traffic matches the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FlowDots({ trace }: { trace: IpcTrace }) {
  const entries = [
    { key: 'renderer:start' as const, color: 'bg-sky-500' },
    { key: 'main:start' as const, color: 'bg-violet-500' },
    { key: 'main:finish' as const, color: 'bg-violet-500' },
    { key: 'renderer:finish' as const, color: 'bg-sky-500' },
  ]
  return (
    <div className="flex items-center gap-[3px]">
      {entries.map((entry, idx) => {
        const filled = trace.phases[entry.key] !== null
        return (
          <div key={entry.key} className="flex items-center gap-[3px]">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                filled ? entry.color : 'bg-muted-foreground/20',
              )}
              title={entry.key}
            />
            {idx < entries.length - 1 && (
              <span className="block h-px w-1.5 bg-muted-foreground/30" />
            )}
          </div>
        )
      })}
    </div>
  )
}
