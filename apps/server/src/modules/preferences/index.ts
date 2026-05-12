import { Elysia } from 'elysia'

import { PreferencesModel } from './model'
import * as Preferences from './service'

export const preferences = new Elysia({
  prefix: '/preferences',
  detail: { tags: ['preferences'] },
})
  .get('/chat', () => Preferences.getChatPreferences(), {
    detail: {
      summary: 'Get chat preferences',
      description: 'Read the server-owned default chat preferences.',
    },
    response: {
      200: PreferencesModel.chatPreferences,
    },
  })
  .put('/chat', async ({ body }) => {
    await Preferences.setChatPreferences(body)
    return { ok: true as const }
  }, {
    detail: {
      summary: 'Set chat preferences',
      description: 'Persist the server-owned default chat preferences.',
    },
    body: PreferencesModel.chatPreferences,
    response: {
      200: PreferencesModel.savedResponse,
    },
  })
