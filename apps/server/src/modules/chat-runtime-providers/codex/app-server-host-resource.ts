import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './app-server-client'
import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
  CodexAppServerNotificationSubscriber,
  CodexAppServerResourceRequestHandler,
} from './types'

export function createCodexAppServerHostResource(input: {
  clientOptions: CodexAppServerClientOptions
  createClient: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}): CodexAppServerHostResource {
  const resource = {
    client: undefined as unknown as CodexAppServerClientLike,
    serverRequestHandlers: new Set<CodexAppServerResourceRequestHandler>(),
    notificationSubscribers: new Set<CodexAppServerNotificationSubscriber>(),
  } satisfies CodexAppServerHostResource
  resource.client = input.createClient({
    ...input.clientOptions,
    serverRequestHandler: request => dispatchCodexAppServerHostRequest(resource, request),
  })
  return resource
}

export function addCodexAppServerHostRequestHandler(
  resource: CodexAppServerHostResource,
  handler: CodexAppServerResourceRequestHandler,
): () => void {
  resource.serverRequestHandlers.add(handler)
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    resource.serverRequestHandlers.delete(handler)
  }
}

export async function dispatchCodexAppServerHostRequest(
  resource: CodexAppServerHostResource,
  request: CodexAppServerServerRequest,
): Promise<unknown> {
  const handlers = [...resource.serverRequestHandlers]
  if (handlers.length === 0) {
    throw new Error(`Codex app-server host has no handler for server request: ${request.method}`)
  }

  const [firstHandler, ...sideEffectHandlers] = handlers
  const result = await firstHandler(request)
  for (const handler of sideEffectHandlers) {
    await Promise.resolve(handler(request)).catch(() => undefined)
  }
  return result
}

export function subscribeCodexAppServerHostNotifications(
  resource: CodexAppServerHostResource,
  subscriber: CodexAppServerNotificationSubscriber,
): () => void {
  resource.notificationSubscribers.add(subscriber)
  startCodexAppServerHostNotificationPump(resource)

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    resource.notificationSubscribers.delete(subscriber)
    if (resource.notificationSubscribers.size === 0) {
      resource.notificationAbortController?.abort()
      resource.notificationAbortController = undefined
      resource.notificationPump = undefined
    }
  }
}

function startCodexAppServerHostNotificationPump(resource: CodexAppServerHostResource): void {
  if (resource.notificationPump) {
    return
  }

  const abortController = new AbortController()
  resource.notificationAbortController = abortController
  resource.notificationPump = (async () => {
    try {
      while (!abortController.signal.aborted) {
        let message: CodexAppServerMessage | null
        try {
          message = await resource.client.nextNotification(abortController.signal)
        }
        catch (error) {
          if (abortController.signal.aborted) {
            return
          }
          throw error
        }
        if (!message) {
          return
        }

        for (const subscriber of [...resource.notificationSubscribers]) {
          let shouldUnsubscribe = false
          try {
            shouldUnsubscribe = subscriber.onMessage(message)
          }
          catch {
            shouldUnsubscribe = true
          }
          if (shouldUnsubscribe) {
            resource.notificationSubscribers.delete(subscriber)
          }
        }

        if (resource.notificationSubscribers.size === 0) {
          abortController.abort()
        }
      }
    }
    finally {
      for (const subscriber of [...resource.notificationSubscribers]) {
        subscriber.onClose()
      }
      resource.notificationSubscribers.clear()
      if (resource.notificationAbortController === abortController) {
        resource.notificationAbortController = undefined
        resource.notificationPump = undefined
      }
    }
  })()
}
