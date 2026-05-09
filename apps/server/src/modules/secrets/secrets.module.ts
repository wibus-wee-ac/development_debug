// Input: secret controller, service, store, and cipher
// Output: secrets module registration
// Position: apps/server/src/modules/secrets/secrets.module.ts

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { SecretCipher } from './secret-cipher'
import { SecretsController } from './secrets.controller'
import { SecretsService } from './secrets.service'
import { SecretsStore } from './secrets.store'

@Module({
  imports: [DatabaseModule],
  controllers: [SecretsController],
  providers: [SecretCipher, SecretsService, SecretsStore],
})
export class SecretsModule {}
