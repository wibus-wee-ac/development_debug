// Input: observability controller, service, and store
// Output: observability module registration
// Position: apps/server/src/modules/observability

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { ObservabilityController } from './observability.controller'
import { ObservabilityService } from './observability.service'
import { ObservabilityStore } from './store'

@Module({
  imports: [DatabaseModule],
  controllers: [ObservabilityController],
  providers: [ObservabilityService, ObservabilityStore],
})
export class ObservabilityModule {}