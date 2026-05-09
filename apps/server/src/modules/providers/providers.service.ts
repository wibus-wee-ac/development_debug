// Input: saved profiles, provider catalog, and secret reader
// Output: provider-owned health-check and model-list semantics with error mapping
// Position: apps/server/src/modules/providers/providers.service.ts

import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { SecretsService } from '../secrets/secrets.service'
import { ProviderCatalog } from './provider-catalog'
import { ProvidersStore } from './providers.store'
import type { ModelDescriptor, ProviderHealthCheckResult, ProviderKind, ProviderRequest } from './types'

@injectable()
export class ProvidersService {
  constructor(
    @inject(SecretsService) private readonly secrets: SecretsService,
    @inject(ProviderCatalog) private readonly catalog: ProviderCatalog,
    @inject(ProvidersStore) private readonly store: ProvidersStore,
  ) {}

  async healthCheck(input: ProviderRequest): Promise<ProviderHealthCheckResult> {
    const provider = this.requireProvider(input.providerKind)
    try {
      const result = await provider.checkHealth(input, {
        readSecret: secretRef => this.secrets.readSecret(secretRef),
      })
      this.store.recordHealthCheck({
        profileId: input.profileId,
        providerKind: input.providerKind,
        subject: input.label,
        ok: result.ok,
        errorText: result.errorText ?? null,
      })
      this.store.recordCapabilitySnapshot({
        profileId: input.profileId,
        providerKind: input.providerKind,
        capabilitiesJson: JSON.stringify(result.details ?? {}),
      })
      return result
    }
    catch (error) {
      throw this.mapOperationalError(error)
    }
  }

  async listModels(input: ProviderRequest): Promise<ModelDescriptor[]> {
    const provider = this.requireProvider(input.providerKind)
    try {
      const models = await provider.listModels(input, {
        readSecret: secretRef => this.secrets.readSecret(secretRef),
      })
      this.store.recordModelList({
        profileId: input.profileId,
        providerKind: input.providerKind,
        subject: input.label,
        count: models.length,
      })
      return models
    }
    catch (error) {
      throw this.mapOperationalError(error)
    }
  }

  private requireProvider(providerKind: ProviderKind) {
    const provider = this.catalog.get(providerKind)
    if (!provider) {
      throw new AppError({
        code: 'provider_not_available',
        status: 501,
        message: `Provider is not available: ${providerKind}`,
        details: { providerKind },
      })
    }
    return provider
  }

  private mapOperationalError(error: unknown): Error {
    if (error instanceof AppError) {
      return error
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'CRADLE_CREDENTIAL_SECRET is not configured') {
      return new AppError({
        code: 'secret_not_configured',
        status: 500,
        message: 'CRADLE_CREDENTIAL_SECRET is required to manage secrets',
      })
    }
    return error instanceof Error ? error : new Error(message)
  }
}