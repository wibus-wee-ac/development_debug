// Input: preferences controller, service, store, and config
// Output: preferences module registration
// Position: apps/server/src/modules/preferences

import { Module } from '@tsuki-hono/common'

import { PreferencesConfig } from './preferences.config'
import { PreferencesController } from './preferences.controller'
import { PreferencesService } from './preferences.service'
import { PreferencesStore } from './preferences.store'

@Module({
  controllers: [PreferencesController],
  providers: [PreferencesConfig, PreferencesService, PreferencesStore],
})
export class PreferencesModule {}