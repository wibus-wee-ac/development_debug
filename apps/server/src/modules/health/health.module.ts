// Input: HealthController
// Output: HealthModule registration
// Position: apps/server/src/modules/health/health.module.ts

import { Module } from '@tsuki-hono/common'

import { HealthController } from './health.controller'

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
