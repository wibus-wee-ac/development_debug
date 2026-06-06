import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import type { PluginCapabilityRecord, PluginDeclaredCapabilityRecord, PluginDescriptor, PluginLayer } from '@cradle/plugin-sdk'

import { AppError } from '../../errors/app-error'
import { getPluginDescriptorByRouteSegment, listPluginDescriptors } from '../../plugins/runtime-registry'

export interface PluginMentionCapability {
  id: string
  type: string
  layer: PluginLayer
  label: string | null
}

export interface PluginMentionCandidate {
  pluginName: string
  displayName: string
  description: string | null
  iconUrl: string | null
  routeSegment: string
  capabilities: PluginMentionCapability[]
  mcpServers: string[]
  active: boolean
}

export interface PluginIconAsset {
  bytes: Uint8Array
  mimeType: string
}

const iconMimeTypesByExtension: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function toMentionCapability(
  capability: PluginCapabilityRecord | PluginDeclaredCapabilityRecord,
): PluginMentionCapability | null {
  if (!capability.layer) {
    return null
  }
  return {
    id: capability.id,
    type: capability.type,
    layer: capability.layer,
    label: capability.label ?? null,
  }
}

function readMcpServerName(capability: PluginCapabilityRecord | PluginDeclaredCapabilityRecord): string | null {
  if (capability.type !== 'mcp-server') {
    return null
  }
  if ('localId' in capability) {
    const localId = capability.localId
    return localId.startsWith('mcp.') ? localId.slice('mcp.'.length) : localId
  }
  const metadataName = typeof capability.metadata?.name === 'string' ? capability.metadata.name : null
  if (metadataName) {
    return metadataName
  }
  const localId = capability.id.startsWith(`${capability.owner}:`)
    ? capability.id.slice(capability.owner.length + 1)
    : capability.id
  return localId.startsWith('mcp-server.') ? localId.slice('mcp-server.'.length) : localId
}

function isPluginActive(descriptor: PluginDescriptor): boolean {
  return descriptor.capabilities.length > 0
    || Object.values(descriptor.layers).some(layer => layer.status === 'active')
}

function pluginIconUrl(descriptor: PluginDescriptor): string | null {
  return descriptor.icon ? `/plugins/${encodeURIComponent(descriptor.routeSegment)}/icon` : null
}

function toMentionCandidate(descriptor: PluginDescriptor): PluginMentionCandidate {
  const capabilityById = new Map<string, PluginMentionCapability>()
  for (const capability of descriptor.declaredCapabilities) {
    const mentionCapability = toMentionCapability(capability)
    if (mentionCapability) {
      capabilityById.set(mentionCapability.id, mentionCapability)
    }
  }
  for (const capability of descriptor.capabilities) {
    const mentionCapability = toMentionCapability(capability)
    if (mentionCapability) {
      capabilityById.set(mentionCapability.id, mentionCapability)
    }
  }

  const mcpServers = new Set<string>()
  for (const capability of [...descriptor.declaredCapabilities, ...descriptor.capabilities]) {
    const serverName = readMcpServerName(capability)
    if (serverName) {
      mcpServers.add(serverName)
    }
  }

  return {
    pluginName: descriptor.name,
    displayName: descriptor.displayName,
    description: descriptor.description ?? null,
    iconUrl: pluginIconUrl(descriptor),
    routeSegment: descriptor.routeSegment,
    capabilities: [...capabilityById.values()],
    mcpServers: [...mcpServers].sort(),
    active: isPluginActive(descriptor),
  }
}

export function listMentionCandidates(): PluginMentionCandidate[] {
  return listPluginDescriptors()
    .map(toMentionCandidate)
    .filter(candidate => candidate.active || candidate.capabilities.length > 0)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function readPluginIcon(routeSegment: string): Promise<PluginIconAsset> {
  const descriptor = getPluginDescriptorByRouteSegment(routeSegment)
  if (!descriptor?.icon) {
    throw new AppError({
      code: 'plugin_icon_not_found',
      status: 404,
      message: 'Plugin icon not found.',
    })
  }

  const extension = extname(descriptor.icon).toLowerCase()
  const mimeType = iconMimeTypesByExtension[extension]
  if (!mimeType) {
    throw new AppError({
      code: 'plugin_icon_unsupported',
      status: 415,
      message: 'Plugin icon type is not supported.',
      details: { routeSegment, extension },
    })
  }

  const packageDir = resolve(descriptor.source.packageDir)
  const iconPath = resolve(packageDir, descriptor.icon)
  if (iconPath !== packageDir && !iconPath.startsWith(`${packageDir}/`)) {
    throw new AppError({
      code: 'plugin_icon_path_invalid',
      status: 400,
      message: 'Plugin icon path is invalid.',
      details: { routeSegment },
    })
  }

  const info = await stat(iconPath).catch(() => null)
  if (!info?.isFile()) {
    throw new AppError({
      code: 'plugin_icon_not_found',
      status: 404,
      message: 'Plugin icon not found.',
      details: { routeSegment },
    })
  }

  return {
    bytes: await readFile(iconPath),
    mimeType,
  }
}
