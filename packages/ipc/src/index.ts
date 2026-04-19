// Main-process exports (IpcService, IpcMethod, createServices, IpcHandler, getIpcContext)
export type { IpcContext, IpcServiceConstructor } from './base'
export {
  createServices,
  getIpcContext,
  IpcHandler,
  IpcMethod,
  IpcService,
  setIpcObserver
} from './base'

// Renderer / preload export
export { createIpcProxy } from './client'

// Type utilities
export type { ExtractServiceMethods, MergeIpcService } from './utility'

// Shared IPC event model
export type {
  IpcObservedEvent,
  IpcObservedPayload,
  IpcObservedPhase,
  IpcObservedSide,
  IpcObservedStatus,
  IpcTraceEnvelope
} from './events'
export {
  IPC_DEVTOOL_METADATA_KEY,
  captureCallerStack,
  createObservedEvent,
  createTraceEnvelope,
  isTraceEnvelope,
  serializeError,
  serializePayload
} from './events'
