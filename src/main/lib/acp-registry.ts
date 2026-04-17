// Input: electron net module (HTTPS), ACP registry CDN
// Output: RegistryAgent types and fetchRegistry() function
// Position: Shared utility used by AcpService to browse available agents

import { net } from 'electron'

export const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

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

export interface Registry {
  version: string
  agents: RegistryAgent[]
}

/** Fetch and parse the ACP registry JSON from the CDN. */
export function fetchRegistry(): Promise<Registry> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url: REGISTRY_URL, redirect: 'follow' })

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Registry fetch failed with HTTP ${response.statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        try {
          const registry = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Registry
          resolve(registry)
        }
        catch (e) {
          reject(new Error(`Failed to parse registry JSON: ${String(e)}`))
        }
      })
      response.on('error', reject)
    })

    request.on('error', reject)
    request.end()
  })
}

const PLATFORM_MAP: Partial<Record<string, PlatformKey>> = {
  'darwin-arm64': 'darwin-aarch64',
  'darwin-x64': 'darwin-x86_64',
  'linux-arm64': 'linux-aarch64',
  'linux-x64': 'linux-x86_64',
  'win32-arm64': 'windows-aarch64',
  'win32-x64': 'windows-x86_64',
}

/** Map Node's process.platform + process.arch to an ACP platform key. */
export function getPlatformKey(): PlatformKey | null {
  return PLATFORM_MAP[`${process.platform}-${process.arch}`] ?? null
}

/** Return the distribution types available for the current platform. */
export function getSupportedDistributionTypes(agent: RegistryAgent): Array<'binary' | 'npx' | 'uvx'> {
  const out: Array<'binary' | 'npx' | 'uvx'> = []
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
