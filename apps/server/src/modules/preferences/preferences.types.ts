// Input: shared chat preference contract
// Output: canonical chat preference schema and default value for the server preferences module
// Position: apps/server/src/modules/preferences shared types

import type { StoredChatPreferences } from '../../../../../src/shared/chat-preferences'
import { z } from 'zod'

export const chatPreferencesSchema = z.object({
  modelId: z.string().nullable(),
  configSelections: z.record(z.string(), z.union([z.string(), z.boolean()])),
})

export type ChatPreferencesInput = z.infer<typeof chatPreferencesSchema>

export const defaultChatPreferences: StoredChatPreferences = {
  modelId: null,
  configSelections: {},
}