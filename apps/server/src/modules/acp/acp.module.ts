// Input: ACP providers and controller
// Output: AcpModule registration
// Position: apps/server/src/modules/acp/acp.module.ts

import { Module } from '@tsuki-hono/common'

import { AcpController } from './acp.controller'
import { AcpInstaller } from './acp.installer'
import { AcpRegistry } from './acp.registry'
import { AcpService } from './acp.service'
import { AcpStore } from './acp.store'

@Module({
  controllers: [AcpController],
  providers: [AcpService, AcpStore, AcpRegistry, AcpInstaller],
})
export class AcpModule {}
