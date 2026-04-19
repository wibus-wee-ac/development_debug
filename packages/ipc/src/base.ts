// Input: AsyncLocalStorage, Electron ipcMain, OpenTelemetry trace API, shared event helpers
// Output: Main-process IPC registration, trace-aware handler context, and observer integration
// Position: Shared main-process IPC framework for all service methods

import { AsyncLocalStorage } from 'node:async_hooks'

import { context as otelContext, trace } from '@opentelemetry/api'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { ipcMain } from 'electron'

import {
  createObservedEvent,
  isTraceEnvelope,
  markSpanError,
  markSpanSuccess,
  serializeError,
  serializePayload
} from './events'

// ── Context ───────────────────────────────────────────────────────────────────

export interface IpcContext {
  sender: WebContents
  event: IpcMainInvokeEvent
  traceId: string | null
  spanId: string | null
  parentSpanId: string | null
  callerStack: string[]
}

const contextStorage = new AsyncLocalStorage<IpcContext>()

let ipcObserver: ((event: ReturnType<typeof createObservedEvent>) => void) | null = null

export function setIpcObserver(observer: typeof ipcObserver): void {
  ipcObserver = observer
}

export function getIpcContext(): IpcContext {
  const context = contextStorage.getStore()
  if (!context) {
    throw new Error('IPC context is not available. Make sure this is called within an IPC handler.')
  }
  return context
}

// ── Decorator metadata ────────────────────────────────────────────────────────

// eslint-disable-next-line ts/no-explicit-any
const methodMetadata = new WeakMap<any, Map<string, string>>()

export function IpcMethod() {
  // eslint-disable-next-line ts/no-explicit-any
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const { constructor } = target
    if (!methodMetadata.has(constructor)) {
      methodMetadata.set(constructor, new Map())
    }
    methodMetadata.get(constructor)!.set(propertyKey, propertyKey)
    return descriptor
  }
}

// ── Handler registry ──────────────────────────────────────────────────────────

export class IpcHandler {
  private static instance: IpcHandler
  private registeredChannels = new Set<string>()

  static getInstance(): IpcHandler {
    if (!IpcHandler.instance) {
      IpcHandler.instance = new IpcHandler()
    }
    return IpcHandler.instance
  }

  registerMethod<TOutput>(
    channel: string,
    // eslint-disable-next-line ts/no-explicit-any
    handler: (...args: any[]) => Promise<TOutput> | TOutput
  ): void {
    if (this.registeredChannels.has(channel)) {
      return
    }
    this.registeredChannels.add(channel)

    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const maybeEnvelope = args[0]
      const traceEnvelope = isTraceEnvelope(maybeEnvelope) ? maybeEnvelope : null
      const handlerArgs = traceEnvelope ? args.slice(1) : args
      const startedAt = traceEnvelope?.startedAt ?? Date.now()
      const span = trace.getTracer('cradle.ipc-devtool').startSpan(channel, {
        attributes: {
          'ipc.channel': channel,
          'ipc.side': 'main'
        }
      })

      const context: IpcContext = {
        sender: event.sender,
        event,
        traceId: traceEnvelope?.traceId ?? null,
        spanId: traceEnvelope?.spanId ?? null,
        parentSpanId: traceEnvelope?.parentSpanId ?? null,
        callerStack: traceEnvelope?.callerStack ?? []
      }

      ipcObserver?.(
        createObservedEvent({
          traceId: traceEnvelope?.traceId ?? 'local',
          spanId: traceEnvelope?.spanId ?? 'local',
          parentSpanId: traceEnvelope?.parentSpanId ?? null,
          channel,
          side: 'main',
          phase: 'start',
          status: 'pending',
          startedAt,
          endedAt: null,
          durationMs: null,
          args: serializePayload(handlerArgs),
          result: null,
          error: null,
          callerStack: traceEnvelope?.callerStack ?? []
        })
      )

      try {
        const result = await contextStorage.run(context, () =>
          otelContext.with(trace.setSpan(otelContext.active(), span), () => handler(...handlerArgs))
        )

        markSpanSuccess()
        ipcObserver?.(
          createObservedEvent({
            traceId: traceEnvelope?.traceId ?? 'local',
            spanId: traceEnvelope?.spanId ?? 'local',
            parentSpanId: traceEnvelope?.parentSpanId ?? null,
            channel,
            side: 'main',
            phase: 'finish',
            status: 'success',
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            args: serializePayload(handlerArgs),
            result: serializePayload(result),
            error: null,
            callerStack: traceEnvelope?.callerStack ?? []
          })
        )

        return result
      } catch (error) {
        markSpanError(error)
        ipcObserver?.(
          createObservedEvent({
            traceId: traceEnvelope?.traceId ?? 'local',
            spanId: traceEnvelope?.spanId ?? 'local',
            parentSpanId: traceEnvelope?.parentSpanId ?? null,
            channel,
            side: 'main',
            phase: 'finish',
            status: 'error',
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            args: serializePayload(handlerArgs),
            result: null,
            error: serializeError(error),
            callerStack: traceEnvelope?.callerStack ?? []
          })
        )
        console.error(`Error in IPC method ${channel}:`, error)
        throw error
      }
    })
  }

  sendToRenderer<T = unknown>(webContents: WebContents, channel: string, data: T): void {
    webContents.send(channel, data)
  }
}

// ── Service base class ────────────────────────────────────────────────────────

export abstract class IpcService {
  protected handler = IpcHandler.getInstance()
  static readonly groupName: string

  constructor() {
    this.registerMethods()
  }

  protected registerMethods(): void {
    const methods = methodMetadata.get(this.constructor)
    if (!methods) {
      return
    }
    methods.forEach((methodName, propertyKey) => {
      // eslint-disable-next-line ts/no-explicit-any
      const method = (this as any)[propertyKey]
      if (typeof method === 'function') {
        this.registerMethod(methodName, method.bind(this))
      }
    })
  }

  protected registerMethod<TOutput>(
    methodName: string,
    // eslint-disable-next-line ts/no-explicit-any
    handler: (...args: any[]) => Promise<TOutput> | TOutput
  ): void {
    const groupName = (this.constructor as typeof IpcService).groupName
    this.handler.registerMethod(`${groupName}.${methodName}`, handler)
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface IpcServiceConstructor {
  new (): IpcService
  readonly groupName: string
}

type CreateServicesResult<T extends readonly IpcServiceConstructor[]> = {
  [K in T[number] as K['groupName']]: InstanceType<K>
}

export function createServices<T extends readonly IpcServiceConstructor[]>(
  serviceConstructors: T
): CreateServicesResult<T> {
  // eslint-disable-next-line ts/no-explicit-any
  const services = {} as any
  for (const ServiceConstructor of serviceConstructors) {
    if (!ServiceConstructor.groupName) {
      throw new Error(`Service ${ServiceConstructor.name} must define a static readonly groupName.`)
    }
    services[ServiceConstructor.groupName] = new ServiceConstructor()
  }
  return services
}
