import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { RuntimeKind } from '~/features/agent-runtime/types'

import { draftRuntimeCapabilitiesQueryKey, getDraftChatRuntimeCapabilities } from './chat-capabilities'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  projectRuntimeComposerSlashCommands,
} from './chat-slash-commands'

export function useRuntimeComposerSlashCommands(
  runtimeKind: RuntimeKind | string | null | undefined,
): ChatComposerSlashCommand[] {
  const { data: draftCapabilities } = useQuery({
    queryKey: draftRuntimeCapabilitiesQueryKey(runtimeKind),
    queryFn: ({ signal }) => getDraftChatRuntimeCapabilities(runtimeKind!, signal),
    enabled: Boolean(runtimeKind) && runtimeKind !== 'cli-tui',
    staleTime: 60_000,
    retry: false,
  })

  return useMemo(() => {
    return projectRuntimeComposerSlashCommands({
      capabilities: draftCapabilities,
      mode: 'draft',
    })
  }, [draftCapabilities])
}
