/* eslint-disable react-refresh/only-export-components */
// Input: defineTab, usePluginStore
// Output: plugin-panel tab definition — renders a plugin's registered panel
// Position: Tab type for dynamically-loaded plugin panels

import { defineTab } from '@cradle/tabs-next'
import { PuzzleIcon } from 'lucide-react'
import { createElement } from 'react'

import { usePluginStore } from '~/lib/plugin-store'

function PluginPanelContent({ params }: { params: { panelId: string } }) {
  const panels = usePluginStore((s) => s.panels)
  const panel = panels.find((p) => p.id === params.panelId)

  if (!panel) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Panel not found: {params.panelId}
      </div>
    )
  }

  return createElement(panel.component, { isActive: true })
}

export const pluginPanelTab = defineTab({
  type: 'plugin-panel' as const,
  label: 'Plugin',
  icon: PuzzleIcon,
  component: PluginPanelContent,
})
