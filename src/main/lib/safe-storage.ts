import { safeStorage } from 'electron'

/**
 * Encrypts a plaintext secret using Electron's OS keychain integration.
 * Falls back to base64-encoding when encryption is unavailable (e.g. headless Linux).
 */
export function encryptSecret(text: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(text).toString('base64')
  }
  return Buffer.from(text).toString('base64')
}

/**
 * Decrypts a value previously encrypted with {@link encryptSecret}.
 */
export function decryptSecret(encrypted: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  return Buffer.from(encrypted, 'base64').toString('utf8')
}
