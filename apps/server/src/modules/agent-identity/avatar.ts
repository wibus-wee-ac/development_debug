export function buildAgentAvatarUrl(style: string | null, seed: string | null): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style ?? 'bottts')}/svg?seed=${encodeURIComponent(seed ?? 'default')}`
}
