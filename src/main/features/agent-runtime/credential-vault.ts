// Input: encryption callbacks backed by Electron safeStorage in production
// Output: CredentialVault for storing secrets and returning masked metadata
// Position: Main-process credential boundary for API-key based providers

import { randomUUID } from 'node:crypto'

import type { ProviderKind } from './runtime-provider-types'

export interface CredentialCipher {
  encrypt: (text: string) => string
  decrypt: (encrypted: string) => string
}

export interface SaveCredentialInput {
  providerKind: ProviderKind
  label: string
  secret: string
}

export interface CredentialMetadata {
  id: string
  providerKind: ProviderKind
  label: string
  maskedSecret: string
  createdAt: number
  updatedAt: number
}

interface StoredCredential {
  id: string
  providerKind: ProviderKind
  label: string
  encryptedSecret: string
  createdAt: number
  updatedAt: number
}

export class CredentialVault {
  private readonly credentials = new Map<string, StoredCredential>()

  constructor(private readonly cipher: CredentialCipher) {}

  save(input: SaveCredentialInput): CredentialMetadata {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const record: StoredCredential = {
      id,
      providerKind: input.providerKind,
      label: input.label,
      encryptedSecret: this.cipher.encrypt(input.secret),
      createdAt: now,
      updatedAt: now,
    }
    this.credentials.set(id, record)
    return this.toMetadata(record)
  }

  readSecret(id: string): string {
    const record = this.credentials.get(id)
    if (!record) {
      throw new Error(`Credential not found: ${id}`)
    }
    return this.cipher.decrypt(record.encryptedSecret)
  }

  remove(id: string): void {
    this.credentials.delete(id)
  }

  list(): CredentialMetadata[] {
    return Array.from(this.credentials.values(), record => this.toMetadata(record))
  }

  private toMetadata(record: StoredCredential): CredentialMetadata {
    return {
      id: record.id,
      providerKind: record.providerKind,
      label: record.label,
      maskedSecret: maskSecret(this.cipher.decrypt(record.encryptedSecret)),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return '...'
  }
  if (secret.startsWith('sk-') && secret.length > 7) {
    return `sk-...${secret.slice(-4)}`
  }
  return `...${secret.slice(-4)}`
}
