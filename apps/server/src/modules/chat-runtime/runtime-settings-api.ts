import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import {
  areRuntimeSettingsEqual,
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  readSessionRuntimeSettings,
  writeSessionRuntimeSettingsConfigJson
} from './runtime-settings'
import { assertStoredSession, getSessionRunContext } from './runtime-session-context'
import { runRegistry } from './run-registry'
import type {
  ChatRuntimeSettings,
  ChatRuntimeSettingsPatch
} from './runtime-provider-types'

const settingsLogger = createChildLogger({ module: 'chat-runtime.runtime-settings' })

export interface ChatRuntimeSettingsDto {
  sessionId: string
  runtimeSettings: ChatRuntimeSettings
  applied: boolean
}

export function getSessionRuntimeSettings(sessionId: string): ChatRuntimeSettingsDto {
  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return {
    sessionId,
    runtimeSettings,
    applied: readRuntimeSettingsApplied(sessionId, runtimeSettings)
  }
}

export async function updateSessionRuntimeSettings(input: {
  sessionId: string
  patch: ChatRuntimeSettingsPatch
}): Promise<ChatRuntimeSettingsDto> {
  const session = assertStoredSession(input.sessionId)
  const runtimeSettings = mergeRuntimeSettings(
    readSessionRuntimeSettings(session.configJson),
    normalizeRuntimeSettingsPatch(input.patch)
  )
  db()
    .update(sessions)
    .set({
      configJson: writeSessionRuntimeSettingsConfigJson(session.configJson, runtimeSettings),
      updatedAt: currentUnixSeconds()
    })
    .where(eq(sessions.id, input.sessionId))
    .run()

  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (!runId) {
    return {
      sessionId: input.sessionId,
      runtimeSettings,
      applied: readRuntimeSettingsApplied(input.sessionId, runtimeSettings)
    }
  }
  const activeRun = runRegistry.getActiveRun(runId)
  let applied = readRuntimeSettingsApplied(input.sessionId, runtimeSettings)
  if (
    !applied &&
    activeRun?.runtime.capabilities.supportsRuntimeSettings &&
    activeRun.runtime.updateRuntimeSettings &&
    !activeRun.terminalStatus
  ) {
    const context = getSessionRunContext(input.sessionId)
    if (context) {
      try {
        await activeRun.runtime.updateRuntimeSettings({
          runtimeSession: activeRun.runtimeSession,
          profile: context.profile,
          settings: runtimeSettings
        })
        activeRun.runtimeSettings = runtimeSettings
        applied = true
      } catch (error) {
        settingsLogger.warn('update runtime settings failed', {
          error,
          sessionId: input.sessionId,
          runId,
          runtimeSettings
        })
      }
    }
  }

  return {
    sessionId: input.sessionId,
    runtimeSettings,
    applied
  }
}

function readRuntimeSettingsApplied(
  sessionId: string,
  runtimeSettings: ChatRuntimeSettings
): boolean {
  if (runRegistry.hasPendingRun(sessionId)) {
    return false
  }
  const activeRunId = runRegistry.getActiveRunIdForSession(sessionId)
  const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : null
  return !activeRun || areRuntimeSettingsEqual(activeRun.runtimeSettings, runtimeSettings)
}
