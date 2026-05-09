// Input: preferences config and filesystem APIs
// Output: filesystem-backed chat preference store under the server data directory
// Position: apps/server/src/modules/preferences persistence boundary

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { StoredChatPreferences } from '../../../../../src/shared/chat-preferences'
import { injectable } from 'tsyringe'

import { defaultChatPreferences, chatPreferencesSchema } from './preferences.types'
import { PreferencesConfig } from './preferences.config'

@injectable()
export class PreferencesStore {
  constructor(private readonly config: PreferencesConfig) {}

  async getChatPreferences(): Promise<StoredChatPreferences> {
    const filePath = this.config.getChatPreferencesPath()

    try {
      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)
      return chatPreferencesSchema.parse(parsed)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...defaultChatPreferences }
      }

      console.warn('[PreferencesStore] failed to read chat preferences, falling back to defaults', {
        error,
        filePath,
      })
      return { ...defaultChatPreferences }
    }
  }

  async saveChatPreferences(preferences: StoredChatPreferences): Promise<void> {
    const filePath = this.config.getChatPreferencesPath()
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(preferences, null, 2), 'utf8')
  }
}