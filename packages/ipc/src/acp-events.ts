// Input: none (pure type definitions)
// Output: Shared ACP devtool event types consumed by main-process store, renderer, and preload
// Position: Cross-process observability primitives for ACP runtime monitoring in @cradle/ipc

export type AcpDevtoolEventKind = 'spawn' | 'output' | 'exit'
export type AcpDevtoolEventStream = 'stdout' | 'stderr' | 'lifecycle'

export interface AcpDevtoolEvent {
  id: string
  timestamp: number
  agentId: string
  pid: number | null
  kind: AcpDevtoolEventKind
  stream: AcpDevtoolEventStream
  text: string
  command: string | null
  args: string[] | null
  cwd: string | null
  exitCode: number | null
  /** POSIX signal name or null — typed as string for cross-runtime compatibility */
  signal: string | null
}
