// Input: CRADLE_CREDENTIAL_SECRET environment variable
// Output: AES-256-GCM cipher for server-owned secret storage
// Position: apps/server/src/modules/secrets/secret-cipher.ts

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { injectable } from 'tsyringe'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

@injectable()
export class SecretCipher {
  private readonly secret = process.env.CRADLE_CREDENTIAL_SECRET?.trim() || null

  isConfigured(): boolean {
    return Boolean(this.secret)
  }

  encrypt(plainText: string): string {
    const key = this.getKey()
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`
  }

  decrypt(encryptedText: string): string {
    const key = this.getKey()
    const [ivPart, payloadPart, tagPart] = encryptedText.split(':')
    if (!ivPart || !payloadPart || !tagPart) {
      throw new Error('Invalid encrypted credential payload')
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadPart, 'base64')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  }

  private getKey(): Buffer {
    if (!this.secret) {
      throw new Error('CRADLE_CREDENTIAL_SECRET is not configured')
    }
    return createHash('sha256').update(this.secret).digest()
  }
}