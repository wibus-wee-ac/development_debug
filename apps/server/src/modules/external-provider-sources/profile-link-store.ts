import { externalProviderProfileLinks } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'

export interface ExternalProfileLinkRow {
  id: string
  sourceKey: string
  externalRecordId: string
  profileId: string
  credentialRef: string | null
  sourceOwnedFieldsJson: string
  lastProjectedFingerprint: string
  createdAt: number
  updatedAt: number
}

export function getExternalProfileLinkRow(profileId: string): ExternalProfileLinkRow | null {
  return db()
    .select()
    .from(externalProviderProfileLinks)
    .where(eq(externalProviderProfileLinks.profileId, profileId))
    .get() ?? null
}

export function isExternalProfile(profileId: string): boolean {
  return getExternalProfileLinkRow(profileId) !== null
}
