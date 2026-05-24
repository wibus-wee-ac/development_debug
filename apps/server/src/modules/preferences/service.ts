import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Static } from 'elysia'

import { getServerConfig } from '../../infra'
import type { PreferencesModel } from './model'
import { ChatPreferencesJsonSchema, JarvisPreferencesJsonSchema } from './model'

function getPath(name: string): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return join(baseDir, 'preferences', `${name}.json`)
}

export async function getChatPreferences(): Promise<Static<typeof PreferencesModel['chatPreferences']>> {
  const filePath = getPath('chat')
  try {
    return ChatPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ChatPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setChatPreferences(preferences: Static<typeof PreferencesModel['chatPreferencesUpdate']>): Promise<void> {
  const filePath = getPath('chat')
  const normalized = ChatPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export async function getJarvisPreferences(): Promise<Static<typeof PreferencesModel['jarvisPreferences']>> {
  const filePath = getPath('jarvis')
  try {
    return JarvisPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return JarvisPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setJarvisPreferences(preferences: Static<typeof PreferencesModel['jarvisPreferences']>): Promise<void> {
  const filePath = getPath('jarvis')
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(preferences, null, 2), 'utf8')
}
