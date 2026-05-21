import {
  deleteTerminalSessionsShellByPtyId,
  postTerminalSessionsShellStart,
} from '~/api-gen/sdk.gen'

export function startShell(params: { ptyId: string, cwd: string, cols: number, rows: number }) {
  return postTerminalSessionsShellStart({
    body: params,
  })
}

export function stopShell(ptyId: string) {
  return deleteTerminalSessionsShellByPtyId({
    path: { ptyId },
  })
}
