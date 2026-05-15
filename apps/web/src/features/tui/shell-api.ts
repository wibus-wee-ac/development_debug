// Input: generated REST SDK for shell PTY lifecycle
// Output: Functions for shell session lifecycle (start, stop)
// Position: API layer extracted from shell-view so HTTP ownership stays limited to explicit resource lifecycle

import {
  deleteTerminalSessionsShellBySessionId,
  postTerminalSessionsShellStart,
} from '~/api-gen/sdk.gen'

export function startShell(params: { ptyId: string, cwd: string, cols: number, rows: number }) {
  return postTerminalSessionsShellStart({
    body: params,
  })
}

export function stopShell(ptyId: string) {
  return deleteTerminalSessionsShellBySessionId({
    path: { sessionId: ptyId },
  })
}
