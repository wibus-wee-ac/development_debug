// Input: model ID
// Output: estimated cost per token
// Position: apps/server/src/modules/usage/pricing.ts

/** USD per 1M tokens */
interface ModelPricing {
  input: number
  output: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'o3': { input: 2.00, output: 8.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'deepseek-chat': { input: 0.27, output: 1.10 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
}

function findPricing(modelId: string): ModelPricing {
  if (MODEL_PRICING[modelId]) {
    return MODEL_PRICING[modelId]
  }
  // Longest prefix match to avoid "gpt-4o" matching "gpt-4o-mini-*"
  const sortedKeys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (modelId.startsWith(key)) {
      return MODEL_PRICING[key]!
    }
  }
  // Unknown model — don't estimate cost
  return { input: 0, output: 0 }
}

export function estimateCost(
  modelId: string,
  usage: { promptTokens: number, completionTokens: number },
): number {
  const pricing = findPricing(modelId)
  return (usage.promptTokens * pricing.input + usage.completionTokens * pricing.output) / 1_000_000
}
