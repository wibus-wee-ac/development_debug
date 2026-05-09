// Input: remote ACP registry JSON over fetch
// Output: registry fetch + supported distribution helpers
// Position: apps/server/src/modules/acp/acp.registry.ts

import { injectable } from 'tsyringe'

export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

export interface BinaryTarget {
  archive: string
  cmd: string
  args?: string[]
  env?: Record<string, string>
}

export interface PackageDistribution {
  package: string
  args?: string[]
  env?: Record<string, string>
}

export type PlatformKey = 'darwin-aarch64' | 'darwin-x86_64' | 'linux-aarch64' | 'linux-x86_64' | 'windows-aarch64' | 'windows-x86_64'
export type AcpDistributionType = 'binary' | 'npx' | 'uvx'

export interface RegistryAgentDistribution {
  binary?: Partial<Record<PlatformKey, BinaryTarget>>
  npx?: PackageDistribution
  uvx?: PackageDistribution
}

export interface RegistryAgent {
  id: string
  name: string
  version: string
  description: string
  repository?: string
  website?: string
  authors?: string[]
  license?: string
  icon?: string
  distribution: RegistryAgentDistribution
}

interface RegistryPayload {
  version: string
  agents: RegistryAgent[]
}

const PLATFORM_MAP: Partial<Record<string, PlatformKey>> = {
  'darwin-arm64': 'darwin-aarch64',
  'darwin-x64': 'darwin-x86_64',
  'linux-arm64': 'linux-aarch64',
  'linux-x64': 'linux-x86_64',
  'win32-arm64': 'windows-aarch64',
  'win32-x64': 'windows-x86_64',
}

@injectable()
export class AcpRegistry {
  async fetchRegistry(): Promise<RegistryAgent[]> {
    const response = await fetch(ACP_REGISTRY_URL)
    if (!response.ok) {
      throw new Error(`ACP registry fetch failed with HTTP ${response.status}`)
    }

    const payload = await response.json() as RegistryPayload
    return Array.isArray(payload.agents) ? payload.agents : []
  }

  getSupportedDistributionTypes(agent: RegistryAgent): AcpDistributionType[] {
    const out: AcpDistributionType[] = []
    const platformKey = getPlatformKey()
    if (platformKey && agent.distribution.binary?.[platformKey]) {
      out.push('binary')
    }
    if (agent.distribution.npx) {
      out.push('npx')
    }
    if (agent.distribution.uvx) {
      out.push('uvx')
    }
    return out
  }
}

export function getPlatformKey(): PlatformKey | null {
  return PLATFORM_MAP[`${process.platform}-${process.arch}`] ?? null
}
