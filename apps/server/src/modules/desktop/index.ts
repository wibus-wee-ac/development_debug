import { Elysia } from 'elysia'

import { DesktopModel } from './model'
import * as Desktop from './service'

export const desktop = new Elysia({
  prefix: '/desktop',
  detail: { tags: ['desktop'] },
})
  .get('/tray/awaits', () => Desktop.getTrayAwaits(), {
    detail: {
      summary: 'Get desktop tray await items',
    },
    response: { 200: DesktopModel.trayAwaits },
  })
  .get('/tray', () => Desktop.getTraySnapshot(), {
    detail: {
      summary: 'Get desktop tray snapshot',
    },
    response: { 200: DesktopModel.traySnapshot },
  })
