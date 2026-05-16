// Input: DiceBear avatar style and seed values
// Output: deterministic avatar image URLs for agent identity views
// Position: shared helper for agent management avatar rendering

export function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}
