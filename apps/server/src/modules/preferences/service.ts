// Input: server config + file system
// Output: chat preferences read/write
// Position: apps/server/src/modules/preferences/service.ts

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Static } from 'elysia'

import { getServerConfig } from '../../infra'
import type { PreferencesModel } from './model'
import { defaultChatPreferences, defaultJarvisPreferences, parseChatPreferences, parseJarvisPreferences } from './model'

function getPath(name: string): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return join(baseDir, 'preferences', `${name}.json`)
}

export async function getChatPreferences(): Promise<Static<typeof PreferencesModel['chatPreferences']>> {
  const filePath = getPath('chat')
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
  const filePath = getPath('chat')
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(preferences, null, 2), 'utf8')
}

export async function getJarvisPreferences(): Promise<Static<typeof PreferencesModel['jarvisPreferences']>> {
  const filePath = getPath('jarvis')
  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    const validated = parseJarvisPreferences(parsed)
    if (validated.success) {
      return validated.data
    }
    return { ...defaultJarvisPreferences }
  }
  catch {
    return { ...defaultJarvisPreferences }
  }
}

export async function setJarvisPreferences(preferences: Static<typeof PreferencesModel['jarvisPreferences']>): Promise<void> {
  const filePath = getPath('jarvis')
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(preferences, null, 2), 'utf8')
}
