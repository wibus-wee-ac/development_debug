import { Elysia } from 'elysia'

import { DesktopModel } from './model'
import * as Desktop from './service'

export const desktop = new Elysia({
  prefix: '/desktop',
  detail: { tags: ['desktop'] },
})
  .get('/tray/counts', () => Desktop.getTrayCounts(), {
    detail: {
      summary: 'Get desktop tray counts',
    },
    response: { 200: DesktopModel.trayCounts },
  })
  .get('/tray/recent-sessions', () => Desktop.getTrayRecentSessions(), {
    detail: {
      summary: 'Get desktop tray recent sessions',
    },
    response: { 200: DesktopModel.trayRecentSessions },
  })
  .get('/tray/health', () => Desktop.getTrayHealth(), {
    detail: {
      summary: 'Get desktop tray health items',
    },
    response: { 200: DesktopModel.trayHealth },
  })
  .get('/tray/awaits', () => Desktop.getTrayAwaits(), {
    detail: {
      summary: 'Get desktop tray await items',
    },
    response: { 200: DesktopModel.trayAwaits },
  })
