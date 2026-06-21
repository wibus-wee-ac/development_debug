/* Type contracts used by the Nowledge Mem settings panel. */

export interface NowledgePluginConfig {
  apiUrl: string
  mcpUrl?: string
  spaceId?: string
  enabled: boolean
  recallEnabled: false
  captureEnabled: false
  hasApiKey: boolean
}

export interface ConfigFormState {
  apiUrl: string
  mcpUrl: string
  spaceId: string
  enabled: boolean
}

export interface RouteOk<T> { ok: true, data: T }
export interface RouteErr { ok: false, code: string, message: string }
export type RouteResponse<T> = RouteOk<T> | RouteErr
