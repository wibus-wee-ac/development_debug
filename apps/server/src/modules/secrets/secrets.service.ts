// Input: secret store
// Output: secret lifecycle semantics and shared secret-reading boundary
// Position: apps/server/src/modules/secrets/secrets.service.ts

import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { SecretsStore } from './secrets.store'
import type { SaveSecretInput, SecretMetadata } from './types'

@injectable()
export class SecretsService {
  constructor(@inject(SecretsStore) private readonly store: SecretsStore) {}

  saveSecret(input: SaveSecretInput): SecretMetadata {
    this.ensureConfigured()
    return this.store.saveSecret(input)
  }

  removeSecret(id: string): void {
    this.store.removeSecret(id)
  }

  listSecrets(): SecretMetadata[] {
    this.ensureConfigured()
    return this.store.listSecrets()
  }

  readSecret(id: string): string {
    this.ensureConfigured()
    try {
      return this.store.readSecret(id)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('Secret not found:')) {
        throw new AppError({
          code: 'secret_not_found',
          status: 400,
          message: 'Secret not found',
          details: { id },
        })
      }
      throw error
    }
  }

  private ensureConfigured(): void {
    if (!this.store.isConfigured()) {
      throw new AppError({
        code: 'secret_not_configured',
        status: 500,
        message: 'CRADLE_CREDENTIAL_SECRET is required to manage secrets',
      })
    }
  }
}