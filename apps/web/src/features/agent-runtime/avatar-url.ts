/**
 * Output: Agent identity avatar URL builder.
 * Input: Persisted Agent avatar style and seed.
 * Position: Agent Runtime-owned identity display helper shared by settings and feature surfaces.
 */

export function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}
