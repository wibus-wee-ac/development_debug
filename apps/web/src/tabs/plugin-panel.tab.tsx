import type { TabParams } from '@cradle/tabs-next'
import { defineTab, useTabFrameActive } from '@cradle/tabs-next'
import { PuzzleIcon } from 'lucide-react'
import { createElement } from 'react'

import { usePluginStore } from '~/lib/plugin-store'

interface PluginPanelTabParams extends TabParams {
  routeSegment?: string
  localId?: string
}

export function serializePluginPanelParams(params: PluginPanelTabParams): string {
  return params.routeSegment && params.localId
    ? `${encodeURIComponent(params.routeSegment)}/${encodeURIComponent(params.localId)}`
    : ''
}

export function deserializePluginPanelParams(path: string): PluginPanelTabParams | null {
  const [routeSegment, localId, ...extra] = path.split('/')
  if (!routeSegment || !localId || extra.length > 0) {
    return null
  }

  try {
    return {
      routeSegment: decodeURIComponent(routeSegment),
      localId: decodeURIComponent(localId),
    }
  }
  catch {
    return null
  }
}

function PluginPanelContent({ params }: { params: PluginPanelTabParams }) {
  const isActive = useTabFrameActive()
  const panels = usePluginStore(s => s.panels)
  const panel = params.routeSegment && params.localId
    ? panels.find(item => item.routeSegment === params.routeSegment && item.localId === params.localId)
    : undefined

  if (!panel) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Panel not found:
{' '}
{params.routeSegment && params.localId ? `${params.routeSegment}/${params.localId}` : 'missing panel route'}
      </div>
    )
  }

  return createElement(panel.component, { isActive })
}

export const pluginPanelTab = defineTab({
  type: 'plugin-panel' as const,
  label: 'Plugin',
  icon: PuzzleIcon,
  component: PluginPanelContent,
  serialize: serializePluginPanelParams,
  deserialize: deserializePluginPanelParams,
})
