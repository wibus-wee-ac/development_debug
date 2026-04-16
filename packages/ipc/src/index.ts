// Main-process exports (IpcService, IpcMethod, createServices, IpcHandler, getIpcContext)
export {
  IpcService,
  IpcMethod,
  IpcHandler,
  createServices,
  getIpcContext,
} from './base'
export type { IpcContext, IpcServiceConstructor } from './base'

// Renderer / preload export
export { createIpcProxy } from './client'

// Type utilities
export type { MergeIpcService, ExtractServiceMethods } from './utility'
