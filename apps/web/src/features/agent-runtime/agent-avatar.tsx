/**
 * Output: Compact Agent identity avatar for renderer surfaces.
 * Input: Agent identity display name and persisted avatar metadata.
 * Position: Agent Runtime-owned visual adapter consumed by feature UIs.
 */

import { BotIcon } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { cn } from '~/lib/cn'

import { buildAvatarUrl } from './avatar-url'

const avatarSizeClass = {
  16: 'size-4',
  18: 'size-[18px]',
  20: 'size-5',
  22: 'size-[22px]',
  24: 'size-6',
} as const

type AgentAvatarSize = keyof typeof avatarSizeClass

export interface AgentAvatarProps {
  name?: string | null
  avatarUrl?: unknown
  avatarStyle?: string | null
  avatarSeed?: string | null
  size?: AgentAvatarSize
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
        avatarSizeClass[size],
        'overflow-hidden rounded-full bg-muted',
        className,
      )}
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
