// Input: pty controller, service, store, and manager
// Output: pty module registration
// Position: apps/server/src/modules/pty/pty.module.ts

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { PtyController } from './pty.controller'
import { PtySessionManager } from './pty.manager'
import { PtyService } from './pty.service'
import { PtyStore } from './pty.store'

@Module({
  imports: [DatabaseModule],
  controllers: [PtyController],
  providers: [PtySessionManager, PtyService, PtyStore],
})
export class PtyModule {}
