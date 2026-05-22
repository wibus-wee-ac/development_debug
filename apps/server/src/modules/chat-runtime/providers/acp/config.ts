import { acpChatConfigJsonSchema } from '../../../../helpers/provider-config-schemas'

export type AcpDistributionType = 'binary' | 'npx' | 'uvx'
export type AcpRuntimeConfig = import('../../../../helpers/provider-config-schemas').AcpChatConfig

export interface AcpConnectionRecord {
  distributionType: AcpDistributionType
  installPath: string | null
  cmd: string
  args: string
  env: string
}

export function buildAcpConnectionRecord(configJson: string): AcpConnectionRecord {
  const parsed = acpChatConfigJsonSchema.parse(configJson)

  return {
    distributionType: parsed.distributionType,
    installPath: parsed.installPath,
    cmd: parsed.cmd,
    args: JSON.stringify(parsed.args),
    env: JSON.stringify(parsed.env),
  }
}
