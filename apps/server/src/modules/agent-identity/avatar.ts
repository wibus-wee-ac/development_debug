// Input: agent avatar style and seed
// Output: Cradle-owned DiceBear avatar URL
// Position: Shared agent-identity avatar policy used by agent CRUD and session persona binding

export function buildAgentAvatarUrl(style: string | null, seed: string | null): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style ?? 'bottts')}/svg?seed=${encodeURIComponent(seed ?? 'default')}`
}
