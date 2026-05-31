// Output: Regression coverage for provider config defaults used by runtime profiles.
// Input: Trusted provider config JSON and Zod provider config schemas.
// Position: Server provider module tests guarding config parser behavior.

import { describe, expect, it } from 'vitest'

import { CodexConfigSchema, readTrustedClaudeAgentConfig, readTrustedCodexConfig } from '../src/modules/provider-contracts/provider-base'

describe('provider config defaults', () => {
  it('uses full-access Codex app-server permissions when no profile override is stored', () => {
    expect(CodexConfigSchema.parse({})).toEqual(expect.objectContaining({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    }))

    expect(readTrustedCodexConfig('{}')).toEqual(expect.objectContaining({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    }))
  })

  it('does not enable Claude Agent global skill discovery by default', () => {
    expect(readTrustedClaudeAgentConfig('{}')).toEqual(expect.objectContaining({
      skills: [],
    }))

    expect(readTrustedClaudeAgentConfig('{"skills":"all"}')).toEqual(expect.objectContaining({
      skills: 'all',
    }))
  })
})
