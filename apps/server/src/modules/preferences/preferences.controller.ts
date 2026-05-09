// Input: preferences service
// Output: HTTP endpoints for server-owned chat preferences
// Position: apps/server/src/modules/preferences

import { Body, Controller, Get, Put } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { PreferencesService } from './preferences.service'
import type { ChatPreferencesInput } from './preferences.types'

@injectable()
@Controller('preferences')
export class PreferencesController {
  constructor(@inject(PreferencesService) private readonly service: PreferencesService) {}

  @Get('/chat')
  async getChatPreferences() {
    return this.service.getChatPreferences()
  }

  @Put('/chat')
  async setChatPreferences(@Body() body?: ChatPreferencesInput) {
    await this.service.setChatPreferences(body)
    return { ok: true }
  }
}