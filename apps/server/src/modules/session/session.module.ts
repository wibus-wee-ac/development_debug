// Input: Session module providers + controller
// Output: SessionModule registration
// Position: apps/server/src/modules/session/session.module.ts

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { PtyModule } from '../pty/pty.module'
import { SessionController } from './session.controller'
import { SessionCleanup } from './session.cleanup'
import { SessionExport } from './session.export'
import { SessionService } from './session.service'
import { SessionStore } from './session.store'

@Module({
  imports: [DatabaseModule, PtyModule],
  controllers: [SessionController],
  providers: [SessionService, SessionStore, SessionExport, SessionCleanup],
})
export class SessionModule {}
