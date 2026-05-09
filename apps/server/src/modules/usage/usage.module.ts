// Input: usage controller and service
// Output: usage module registration
// Position: apps/server/src/modules/usage/usage.module.ts

import { Module } from '@tsuki-hono/common'

import { UsageController } from './usage.controller'
import { UsageService } from './usage.service'

@Module({
  controllers: [UsageController],
  providers: [UsageService],
})
export class UsageModule {}
