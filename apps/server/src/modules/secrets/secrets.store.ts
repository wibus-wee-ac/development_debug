// Input: DbAccessor and secret cipher
// Output: DB-backed secret storage and masked metadata projection
// Position: apps/server/src/modules/secrets/secrets.store.ts

import { randomUUID } from 'node:crypto'

import { agentCredentials } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import { SecretCipher } from './secret-cipher'
import type { SaveSecretInput, SecretMetadata } from './types'

@injectable()
export class SecretsStore {
  constructor(
    private readonly dbAccessor: DbAccessor,
    private readonly cipher: SecretCipher,
  ) {}

  saveSecret(input: SaveSecretInput): SecretMetadata {
    const now = Math.floor(Date.now() / 1000)
    const id = randomUUID()
    const encryptedSecret = this.cipher.encrypt(input.secret)

    this.dbAccessor.get().insert(agentCredentials).values({
      id,
      kind: input.kind,
      label: input.label,
      encryptedSecret,
      createdAt: now,
      updatedAt: now,
    }).run()

    return {
      id,
      kind: input.kind,
      label: input.label,
      maskedSecret: maskSecret(input.secret),
      createdAt: now,
      updatedAt: now,
    }
  }

  readSecret(id: string): string {
    const secret = this.dbAccessor.get().select().from(agentCredentials).where(eq(agentCredentials.id, id)).get()
    if (!secret) {
      throw new Error(`Secret not found: ${id}`)
    }
    return this.cipher.decrypt(secret.encryptedSecret)
  }

  removeSecret(id: string): void {
    this.dbAccessor.get().delete(agentCredentials).where(eq(agentCredentials.id, id)).run()
  }

  listSecrets(): SecretMetadata[] {
    return this.dbAccessor.get().select().from(agentCredentials).orderBy(agentCredentials.label).all().map((secret) => {
      const plainText = this.cipher.decrypt(secret.encryptedSecret)
      return {
        id: secret.id,
        kind: secret.kind,
        label: secret.label,
        maskedSecret: maskSecret(plainText),
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      }
    })
  }

  isConfigured(): boolean {
    return this.cipher.isConfigured()
  }
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return '...'
  }
  if (secret.startsWith('sk-') && secret.length > 7) {
    return `sk-...${secret.slice(-4)}`
  }
  return `...${secret.slice(-4)}`
}