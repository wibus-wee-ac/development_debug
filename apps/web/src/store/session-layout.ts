// Output: Renderer-side cache of session layout metadata used by the app shell.
// Input: Session list rows, session detail queries, and newly created sessions.
// Position: Store-owned bridge from chat/session data to layout identity derivation.

import { create } from 'zustand'

import type { RuntimeKind } from '~/lib/types'

export interface SessionLayoutRecord {
  sessionId: string
  sessionTitle: string | null
  workspaceId: string | null
  workspacePath: string | null
  runtimeKind: RuntimeKind | null
}

export interface WorkspaceLayoutRecord {
  workspaceId: string
  workspaceName: string | null
  workspacePath: string | null
}

interface SessionLayoutState {
  sessions: Record<string, SessionLayoutRecord>
  workspaces: Record<string, WorkspaceLayoutRecord>
  upsertSession: (record: Partial<Omit<SessionLayoutRecord, 'sessionId'>> & { sessionId: string }) => void
  upsertSessions: (records: Array<Partial<Omit<SessionLayoutRecord, 'sessionId'>> & { sessionId: string }>) => void
  upsertWorkspace: (record: Partial<Omit<WorkspaceLayoutRecord, 'workspaceId'>> & { workspaceId: string }) => void
  upsertWorkspaces: (records: Array<Partial<Omit<WorkspaceLayoutRecord, 'workspaceId'>> & { workspaceId: string }>) => void
}

function mergeSessionLayoutRecord(
  current: SessionLayoutRecord | undefined,
  patch: Partial<Omit<SessionLayoutRecord, 'sessionId'>> & { sessionId: string },
): SessionLayoutRecord {
  return {
    sessionId: patch.sessionId,
    sessionTitle: 'sessionTitle' in patch ? patch.sessionTitle ?? null : current?.sessionTitle ?? null,
    workspaceId: 'workspaceId' in patch ? patch.workspaceId ?? null : current?.workspaceId ?? null,
    workspacePath: 'workspacePath' in patch ? patch.workspacePath ?? null : current?.workspacePath ?? null,
    runtimeKind: 'runtimeKind' in patch ? patch.runtimeKind ?? null : current?.runtimeKind ?? null,
  }
}

function mergeWorkspaceLayoutRecord(
  current: WorkspaceLayoutRecord | undefined,
  patch: Partial<Omit<WorkspaceLayoutRecord, 'workspaceId'>> & { workspaceId: string },
): WorkspaceLayoutRecord {
  return {
    workspaceId: patch.workspaceId,
    workspaceName: 'workspaceName' in patch ? patch.workspaceName ?? null : current?.workspaceName ?? null,
    workspacePath: 'workspacePath' in patch ? patch.workspacePath ?? null : current?.workspacePath ?? null,
  }
}

export const useSessionLayoutStore = create<SessionLayoutState>()(set => ({
  sessions: {},
  workspaces: {},

  upsertSession: (record) => {
    set(state => ({
      sessions: {
        ...state.sessions,
        [record.sessionId]: mergeSessionLayoutRecord(state.sessions[record.sessionId], record),
      },
    }))
  },

  upsertSessions: (records) => {
    if (records.length === 0) {
      return
    }

    set((state) => {
      const sessions = { ...state.sessions }
      for (const record of records) {
        sessions[record.sessionId] = mergeSessionLayoutRecord(sessions[record.sessionId], record)
      }
      return { sessions }
    })
  },

  upsertWorkspace: (record) => {
    set(state => ({
      workspaces: {
        ...state.workspaces,
        [record.workspaceId]: mergeWorkspaceLayoutRecord(state.workspaces[record.workspaceId], record),
      },
    }))
  },

  upsertWorkspaces: (records) => {
    if (records.length === 0) {
      return
    }

    set((state) => {
      const workspaces = { ...state.workspaces }
      for (const record of records) {
        workspaces[record.workspaceId] = mergeWorkspaceLayoutRecord(workspaces[record.workspaceId], record)
      }
      return { workspaces }
    })
  },
}))
