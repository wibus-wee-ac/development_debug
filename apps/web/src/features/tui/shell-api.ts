// Input: injected server URL, shell PTY parameters
// Output: Functions for shell session lifecycle (start, resize, input)
// Position: API layer extracted from shell-view to avoid fetch-in-effect lint violations

import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export function startShell(params: { ptyId: string, cwd: string, cols: number, rows: number }) {
  return fetch(`${SERVER_BASE}/terminal-sessions/shell/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export function resizeShell(ptyId: string, cols: number, rows: number) {
  return fetch(`${SERVER_BASE}/terminal-sessions/shell/${ptyId}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  })
}

export function sendShellInput(ptyId: string, data: string) {
  return fetch(`${SERVER_BASE}/terminal-sessions/shell/${ptyId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}

export function getShellStreamUrl(ptyId: string) {
  return `${SERVER_BASE}/terminal-sessions/shell/${ptyId}/stream`
}
