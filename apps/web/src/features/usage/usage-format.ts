export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    if (Number(thousands.toFixed(1)) >= 1_000) {
      return `${(value / 1_000_000).toFixed(1)}M`
    }
    return `${thousands.toFixed(1)}K`
  }
  return value.toString()
}

export function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) {
    return `$${value.toFixed(4)}`
  }
  return `$${value.toFixed(2)}`
}
