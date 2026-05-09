// Input: provider controller, service, audit store, and provider catalog
// Output: providers module registration
// Position: apps/server/src/modules/providers/providers.module.ts

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { SecretsModule } from '../secrets/secrets.module'
import { ProviderCatalog } from './provider-catalog'
import { ProvidersController } from './providers.controller'
import { ProvidersService } from './providers.service'
import { ProvidersStore } from './providers.store'

@Module({
  imports: [DatabaseModule, SecretsModule],
  controllers: [ProvidersController],
  providers: [ProviderCatalog, ProvidersService, ProvidersStore],
})
export class ProvidersModule {}