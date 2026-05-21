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
  const distributionType = parsed.distributionType ?? 'npx'
  const cmd = parsed.cmd ?? parsed.packageName

  if (!cmd) {
    throw new Error('ACP agent command (cmd) is required in configJson')
  }

  return {
    distributionType,
    installPath: parsed.installPath ?? null,
    cmd,
    args: JSON.stringify(parsed.args ?? []),
    env: JSON.stringify(parsed.env ?? {}),
  }
}
