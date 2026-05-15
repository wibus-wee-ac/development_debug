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
      'x-cradle-cli': {
        command: ['preferences', 'chat', 'get'],
      },
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
      'x-cradle-cli': {
        command: ['preferences', 'chat', 'set'],
      },
    },
    body: PreferencesModel.chatPreferences,
    response: {
      200: PreferencesModel.savedResponse,
    },
  })
  .get('/jarvis', () => Preferences.getJarvisPreferences(), {
    detail: {
      summary: 'Get Jarvis preferences',
      description: 'Read the system agent (Jarvis) configuration.',
      'x-cradle-cli': {
        command: ['preferences', 'jarvis', 'get'],
      },
    },
    response: {
      200: PreferencesModel.jarvisPreferences,
    },
  })
  .put('/jarvis', async ({ body }) => {
    await Preferences.setJarvisPreferences(body)
    return { ok: true as const }
  }, {
    detail: {
      summary: 'Set Jarvis preferences',
      description: 'Persist the system agent (Jarvis) provider and model config.',
      'x-cradle-cli': {
        command: ['preferences', 'jarvis', 'set'],
      },
    },
    body: PreferencesModel.jarvisPreferences,
    response: {
      200: PreferencesModel.savedResponse,
    },
  })
