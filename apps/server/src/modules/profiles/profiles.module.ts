// Input: profile controller, service, store, and session dependency
// Output: profiles module registration
// Position: apps/server/src/modules/profiles/profiles.module.ts

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { SessionModule } from '../session/session.module'
import { ProfilesController } from './profiles.controller'
import { ProfilesService } from './profiles.service'
import { ProfilesStore } from './profiles.store'

@Module({
  imports: [DatabaseModule, SessionModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfilesStore],
})
export class ProfilesModule {}