import { getServerUrl } from '~/lib/electron'

const ASSET_URL_PREFIX = 'cradle-asset://'

export function isCradleAssetUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ASSET_URL_PREFIX) && value.length > ASSET_URL_PREFIX.length
}

export function readAssetIdFromUrl(value: string): string | null {
  if (!isCradleAssetUrl(value)) {
    return null
  }
  const encodedId = value.slice(ASSET_URL_PREFIX.length)
  if (!encodedId) {
    return null
  }
  try {
    return decodeURIComponent(encodedId)
  }
  catch {
    return null
  }
}

export function toAssetMarkdownUrl(id: string): string {
  return `${ASSET_URL_PREFIX}${encodeURIComponent(id)}`
}

export function toAssetContentUrl(id: string): string {
  return new URL(`/assets/${encodeURIComponent(id)}/content`, getServerUrl()).toString()
}
