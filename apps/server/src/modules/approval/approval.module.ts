// Input: approval controller and service
// Output: approval module registration
// Position: apps/server/src/modules/approval

import { Module } from '@tsuki-hono/common'

import { ApprovalController } from './approval.controller'
import { ApprovalService } from './approval.service'

@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService],
})
export class ApprovalModule {}