// Main-process exports (IpcService, IpcMethod, createServices, IpcHandler, getIpcContext)
export type { IpcContext, IpcServiceConstructor } from './base'
export {
  createServices,
  getIpcContext,
  IpcHandler,
  IpcMethod,
  IpcService,
} from './base'

// Renderer / preload export
export { createIpcProxy } from './client'

// Type utilities
export type { ExtractServiceMethods, MergeIpcService } from './utility'
