/**
 * Output: Compact Agent identity avatar for renderer surfaces.
 * Input: Agent identity display name and persisted avatar metadata.
 * Position: Agent Runtime-owned visual adapter consumed by feature UIs.
 */

import { BotIcon } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { cn } from '~/lib/cn'

import { buildAvatarUrl } from './avatar-url'

export interface AgentAvatarProps {
  name?: string | null
  avatarUrl?: unknown
  avatarStyle?: string | null
  avatarSeed?: string | null
  size?: number
  className?: string
}

function avatarImageUrl(avatarUrl: unknown, avatarStyle?: string | null, avatarSeed?: string | null): string | null {
  if (typeof avatarUrl === 'string' && avatarUrl.length > 0) {
    return avatarUrl
  }
  if (avatarStyle && avatarSeed) {
    return buildAvatarUrl(avatarStyle, avatarSeed)
  }
  return null
}

export function AgentAvatar({
  name,
  avatarUrl,
  avatarStyle,
  avatarSeed,
  size = 20,
  className,
}: AgentAvatarProps) {
  const imageUrl = avatarImageUrl(avatarUrl, avatarStyle, avatarSeed)
  const initial = name?.trim().charAt(0)?.toUpperCase()

  return (
    <Avatar
      size="sm"
      className={cn(
        'overflow-hidden rounded-full bg-muted',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {imageUrl && (
        <AvatarImage
          src={imageUrl}
          alt={name ?? ''}
          className="rounded-full"
          crossOrigin="anonymous"
        />
      )}
      <AvatarFallback className="text-[10px] font-medium">
        {initial ?? <BotIcon className="size-3" aria-hidden="true" />}
      </AvatarFallback>
    </Avatar>
  )
}
