import { randomUUID } from 'node:crypto'

import type { RemoteRuntimeSessionLink } from '@cradle/db'
import { remoteRuntimeSessionLinks } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'

export interface UpsertRemoteRuntimeSessionLinkInput {
  chatSessionId: string
  remoteHostId: string
  remoteAgentId: string
  remoteRuntimeKind: string
  daemonHostId?: string | null
  providerSessionId?: string | null
  stateSnapshotJson?: string
}

export function readRemoteRuntimeSessionLink(chatSessionId: string): RemoteRuntimeSessionLink | null {
  return db()
    .select()
    .from(remoteRuntimeSessionLinks)
    .where(eq(remoteRuntimeSessionLinks.chatSessionId, chatSessionId))
    .get() ?? null
}

export function upsertRemoteRuntimeSessionLink(
  input: UpsertRemoteRuntimeSessionLinkInput,
): RemoteRuntimeSessionLink {
  const now = currentUnixSeconds()
  db()
    .insert(remoteRuntimeSessionLinks)
    .values({
      id: randomUUID(),
      chatSessionId: input.chatSessionId,
      remoteHostId: input.remoteHostId,
      remoteAgentId: input.remoteAgentId,
      remoteRuntimeKind: input.remoteRuntimeKind,
      daemonHostId: input.daemonHostId ?? null,
      providerSessionId: input.providerSessionId ?? null,
      stateSnapshotJson: input.stateSnapshotJson ?? '{}',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: remoteRuntimeSessionLinks.chatSessionId,
      set: {
        remoteHostId: input.remoteHostId,
        remoteAgentId: input.remoteAgentId,
        remoteRuntimeKind: input.remoteRuntimeKind,
        daemonHostId: input.daemonHostId ?? null,
        providerSessionId: input.providerSessionId ?? null,
        stateSnapshotJson: input.stateSnapshotJson ?? '{}',
        updatedAt: now,
      },
    })
    .run()

  return readRemoteRuntimeSessionLink(input.chatSessionId) as RemoteRuntimeSessionLink
}

export function deleteRemoteRuntimeSessionLink(chatSessionId: string): void {
  db()
    .delete(remoteRuntimeSessionLinks)
    .where(eq(remoteRuntimeSessionLinks.chatSessionId, chatSessionId))
    .run()
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
