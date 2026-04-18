// Input: IpcService base and app preference store helpers
// Output: PreferencesService IPC handler for global chat defaults
// Position: Main-process service exposing persisted app preferences to renderer

import { IpcMethod, IpcService } from '@cradle/ipc'

import type { StoredChatPreferences } from '@shared/chat-preferences'

import { getChatPreferences, setChatPreferences } from '../store/app'

export class PreferencesService extends IpcService {
  static readonly groupName = 'preferences'

  @IpcMethod()
  getChatPreferences(): StoredChatPreferences {
    return getChatPreferences()
  }

  @IpcMethod()
  setChatPreferences(preferences: StoredChatPreferences): void {
    setChatPreferences(preferences)
  }
}
