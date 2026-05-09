// Input: secret metadata contracts and supported kinds
// Output: shared secret API shapes for secrets module
// Position: apps/server/src/modules/secrets/types.ts

export type SecretKind = string

export interface SecretMetadata {
  id: string
  kind: SecretKind
  label: string
  maskedSecret: string
  createdAt: number
  updatedAt: number
}

export interface SaveSecretInput {
  kind: SecretKind
  label: string
  secret: string
}
