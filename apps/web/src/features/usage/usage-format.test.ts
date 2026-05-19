// Input: Vitest, usage formatting helpers
// Output: Regression coverage for usage dashboard numeric labels
// Position: Usage feature unit tests for display formatting

import { describe, expect, it } from 'vitest'

import { formatTokens, formatUsd } from './usage-format'

describe('usage formatting', () => {
  it('formats token counts with compact K and M suffixes', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1.0K')
    expect(formatTokens(12_340)).toBe('12.3K')
    expect(formatTokens(999_949)).toBe('999.9K')
    expect(formatTokens(999_950)).toBe('1.0M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
  })

  it('keeps tiny non-zero USD values visible', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(0.01)).toBe('$0.01')
    expect(formatUsd(12.345)).toBe('$12.35')
  })
})
