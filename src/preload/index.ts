// Input: electron-toolkit preload helpers, Electron contextBridge
// Output: Safe renderer globals — unified signal bridge + devtool subscriptions
// Position: Shared preload bridge loaded by all BrowserWindow instances

import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

const SIGNAL_CHANNEL = 'cradle:signal'
const ACP_DEVTOOL_EVENT_CHANNEL = 'acp-devtool:event'
const IPC_DEVTOOL_EVENT_CHANNEL = 'ipc-devtool:event'
const AGENT_CONTEXT_DEVTOOL_EVENT_CHANNEL = 'agent-context-devtool:event'
const OBSERVABILITY_DEVTOOL_EVENT_CHANNEL = 'observability-devtool:event'

// ── Unified Signal Bridge ─────────────────────────────────────────────────────
// One subscribe gateway for ALL push events from main process.
// Topics are strongly typed in shared/push-events.ts PushEventMap.

const cradle = {
  subscribe: (topic: string, listener: (payload: unknown) => void) => {
    const wrapped = (_event: unknown, incomingTopic: string, payload: unknown) => {
      if (incomingTopic === topic) {
        listener(payload)
      }
    }
    electronAPI.ipcRenderer.on(SIGNAL_CHANNEL, wrapped)
    return () => {
      electronAPI.ipcRenderer.removeListener(SIGNAL_CHANNEL, wrapped)
    }
  },
}

// ── Devtool (observability, not business) ─────────────────────────────────────

const ipcDevtool = {
  getSnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getSnapshot'),
  clear: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clear'),
  getAcpSnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getAcpSnapshot'),
  clearAcp: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clearAcp'),
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)
    return () => {
      electronAPI.ipcRenderer.removeListener(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
  onAcpEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(ACP_DEVTOOL_EVENT_CHANNEL, wrapped)
    return () => {
      electronAPI.ipcRenderer.removeListener(ACP_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
  getAgentContextSnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getAgentContextSnapshot'),
  clearAgentContext: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clearAgentContext'),
  onAgentContextEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(AGENT_CONTEXT_DEVTOOL_EVENT_CHANNEL, wrapped)
    return () => {
      electronAPI.ipcRenderer.removeListener(AGENT_CONTEXT_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
  getObservabilitySnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getObservabilitySnapshot'),
  clearObservability: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clearObservability'),
  flushObservability: () => electronAPI.ipcRenderer.invoke('ipcDevtool.flushObservability'),
  exportObservabilityBundle: (input: unknown) => electronAPI.ipcRenderer.invoke('ipcDevtool.exportObservabilityBundle', input),
  onObservabilityEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(OBSERVABILITY_DEVTOOL_EVENT_CHANNEL, wrapped)
    return () => {
      electronAPI.ipcRenderer.removeListener(OBSERVABILITY_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
}

// ── Expose ────────────────────────────────────────────────────────────────────

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('cradle', cradle)
    contextBridge.exposeInMainWorld('ipcDevtool', ipcDevtool)
  }
  catch (error) {
    console.error(error)
  }
}
else {
  // @ts-expect-error global assignment outside contextBridge
  window.electron = electronAPI
  // @ts-expect-error global assignment outside contextBridge
  window.cradle = cradle
  // @ts-expect-error global assignment outside contextBridge
  window.ipcDevtool = ipcDevtool
}
