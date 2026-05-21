/* eslint-disable react-refresh/only-export-components */

import { defineTab } from '@cradle/tabs-next'
import { PuzzleIcon } from 'lucide-react'
import { createElement } from 'react'

import { usePluginStore } from '~/lib/plugin-store'

function PluginPanelContent({ params }: { params: { panelId: string } }) {
  const panels = usePluginStore((s) => s.panels)
  const panel = panels.find((p) => p.id === params.panelId)
  const legacyMatches = panel ? [] : panels.filter((p) => p.localId === params.panelId)
  const resolvedPanel = panel ?? (legacyMatches.length === 1 ? legacyMatches[0] : undefined)

  if (!resolvedPanel) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Panel not found: {params.panelId}
      </div>
    )
  }

  return createElement(resolvedPanel.component, { isActive: true })
}

export const pluginPanelTab = defineTab({
  type: 'plugin-panel' as const,
  label: 'Plugin',
  icon: PuzzleIcon,
  component: PluginPanelContent,
})
