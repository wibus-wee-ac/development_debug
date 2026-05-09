// Input: preferences store and shared chat preference contract
// Output: preferences orchestration for HTTP-facing chat default persistence
// Position: apps/server/src/modules/preferences application service

import type { StoredChatPreferences } from '../../../../../src/shared/chat-preferences'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { PreferencesStore } from './preferences.store'
import { chatPreferencesSchema } from './preferences.types'
import type { ChatPreferencesInput } from './preferences.types'

@injectable()
export class PreferencesService {
  constructor(@inject(PreferencesStore) private readonly store: PreferencesStore) {}

  async getChatPreferences(): Promise<StoredChatPreferences> {
    return this.store.getChatPreferences()
  }

  async setChatPreferences(preferences: ChatPreferencesInput | undefined): Promise<void> {
    const parsed = chatPreferencesSchema.safeParse(preferences)
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_preferences_input',
        status: 400,
        message: 'chat preferences payload is invalid',
        details: {
          issues: parsed.error.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      })
    }

    await this.store.saveChatPreferences(parsed.data)
  }
}