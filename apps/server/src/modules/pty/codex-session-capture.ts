// Input: Codex CLI session JSONL metadata files and Cradle PTY launch context
// Output: Conservative Codex session-id discovery for cli-tui resume bindings
// Position: apps/server/src/modules/pty helper owned by the PTY capability

import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { createInterface } from 'node:readline'

import type { CodexCliSessionBinding } from '../../helpers/agent-runtime-config'

const MAX_FILES_PER_DIRECTORY = 80
const MAX_CANDIDATE_FILES = 120
const CAPTURE_LOOKBACK_MS = 5_000
const CAPTURE_LOOKAHEAD_MS = 120_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLLOUT_FILENAME_RE = /^rollout-.+\.jsonl$/

export interface CaptureCodexCliSessionInput {
  workspacePath: string
  startedAt: number
  codexSessionsRoot?: string
  now?: () => number
}

interface CandidateFile {
  path: string
  mtimeMs: number
}

interface CodexSessionMeta {
  id: string
  timestampMs: number
  cwd: string
  originator: string
}

interface CodexSessionMetaLine {
  type?: unknown
  payload?: {
    id?: unknown
    timestamp?: unknown
    cwd?: unknown
    originator?: unknown
  }
}

export async function captureCodexCliSession(input: CaptureCodexCliSessionInput): Promise<CodexCliSessionBinding | null> {
  const root = input.codexSessionsRoot ?? defaultCodexSessionsRoot()
  const files = await listRecentSessionFiles({
    root,
    startedAt: input.startedAt,
  })

  const workspacePath = normalize(input.workspacePath)
  const lowerBound = input.startedAt - CAPTURE_LOOKBACK_MS
  const upperBound = input.startedAt + CAPTURE_LOOKAHEAD_MS
  const matches: Array<CodexSessionMeta & { sourcePath: string }> = []

  for (const file of files) {
    const meta = await readSessionMeta(file.path)
    if (!meta) {
      continue
    }
    if (normalize(meta.cwd) !== workspacePath) {
      continue
    }
    if (meta.originator !== 'codex-tui') {
      continue
    }
    if (meta.timestampMs < lowerBound || meta.timestampMs > upperBound) {
      continue
    }
    matches.push({ ...meta, sourcePath: file.path })
  }

  if (matches.length !== 1) {
    return null
  }

  const match = matches[0]!
  return {
    sessionId: match.id,
    capturedAt: Math.floor((input.now?.() ?? Date.now()) / 1000),
    startedAt: Math.floor(input.startedAt / 1000),
    workspacePath,
    sourcePath: match.sourcePath,
  }
}

function defaultCodexSessionsRoot(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
}

async function listRecentSessionFiles(input: {
  root: string
  startedAt: number
}): Promise<CandidateFile[]> {
  const directories = sessionDirectoriesNear(input.root, new Date(input.startedAt))
  const lowerBound = input.startedAt - CAPTURE_LOOKBACK_MS
  const upperBound = input.startedAt + CAPTURE_LOOKAHEAD_MS
  const files: CandidateFile[] = []

  for (const directory of directories) {
    let names: string[]
    try {
      names = await readdir(directory)
    }
    catch {
      continue
    }

    const directoryFiles: CandidateFile[] = []
    for (const name of names) {
      if (!ROLLOUT_FILENAME_RE.test(name)) {
        continue
      }

      const path = join(directory, name)
      try {
        const stats = await stat(path)
        if (!stats.isFile()) {
          continue
        }
        if (stats.mtimeMs < lowerBound || stats.mtimeMs > upperBound) {
          continue
        }
        directoryFiles.push({ path, mtimeMs: stats.mtimeMs })
      }
      catch {
        continue
      }
    }

    directoryFiles.sort((left, right) => right.mtimeMs - left.mtimeMs)
    files.push(...directoryFiles.slice(0, MAX_FILES_PER_DIRECTORY))
  }

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_CANDIDATE_FILES)
}

function sessionDirectoriesNear(root: string, date: Date): string[] {
  const days = [
    new Date(date.getTime() - 24 * 60 * 60 * 1000),
    date,
    new Date(date.getTime() + 24 * 60 * 60 * 1000),
  ]

  return Array.from(new Set(days.map(day => join(
    root,
    String(day.getFullYear()),
    padDatePart(day.getMonth() + 1),
    padDatePart(day.getDate()),
  ))))
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

async function readSessionMeta(path: string): Promise<CodexSessionMeta | null> {
  const line = await readFirstLine(path)
  if (!line) {
    return null
  }

  try {
    const parsed = JSON.parse(line) as CodexSessionMetaLine
    if (parsed.type !== 'session_meta') {
      return null
    }

    const id = parsed.payload?.id
    const timestamp = parsed.payload?.timestamp
    const cwd = parsed.payload?.cwd
    const originator = parsed.payload?.originator
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return null
    }
    if (typeof timestamp !== 'string') {
      return null
    }
    if (typeof cwd !== 'string' || !cwd.trim()) {
      return null
    }
    if (typeof originator !== 'string') {
      return null
    }

    const timestampMs = Date.parse(timestamp)
    if (!Number.isFinite(timestampMs)) {
      return null
    }

    return { id, timestampMs, cwd, originator }
  }
  catch {
    return null
  }
}

async function readFirstLine(path: string): Promise<string | null> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of reader) {
      return line
    }
    return null
  }
  finally {
    reader.close()
    stream.destroy()
  }
}

export const __codexSessionCaptureTestUtils = {
  readSessionMeta,
  sessionDirectoriesNear,
}
