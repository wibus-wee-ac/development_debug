// Input: server config + file system
// Output: chat preferences read/write
// Position: apps/server/src/modules/preferences/service.ts

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Static } from 'elysia'

import { getServerConfig } from '../../infra'
import type { PreferencesModel } from './model'
import { defaultChatPreferences, parseChatPreferences } from './model'

function getPath(): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return join(baseDir, 'preferences', 'chat.json')
}

export async function getChatPreferences(): Promise<Static<typeof PreferencesModel['chatPreferences']>> {
  const filePath = getPath()
  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    const validated = parseChatPreferences(parsed)
    if (validated.success) {
      return validated.data
    }
    throw new Error('stored chat preferences payload is invalid')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...defaultChatPreferences }
    }
    console.warn('[preferences] failed to read chat preferences, falling back to defaults', { error, filePath })
    return { ...defaultChatPreferences }
  }
}

export async function setChatPreferences(preferences: Static<typeof PreferencesModel['chatPreferences']>): Promise<void> {
  const filePath = getPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(preferences, null, 2), 'utf8')
}
