/* Web plugin entry — registers the Nowledge Mem workspace panel and wires
   up the UI store. All UI lives under ./web/. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { BrainLine as BrainIcon } from '@mingcute/react'

import { initNowledgeUiStore } from './web/store'
import { NowledgeShell } from './web/shell'

export function activate(ctx: WebPluginContext): void {
  initNowledgeUiStore(ctx.storage)

  ctx.panels.register({
    id: 'config',
    title: 'Nowledge Mem',
    icon: BrainIcon,
    component: props => <NowledgeShell {...props} ctx={ctx} />,
    location: 'sidebar',
  })

  ctx.logger.info('Nowledge Mem plugin (web) activated')
}
