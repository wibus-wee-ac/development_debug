import type { AfterResponseHandler, BeforeQueryHandler, Disposable, QueryHookContext, ResponseHookContext } from '@cradle/plugin-sdk/server'

const beforeQueryHandlers: BeforeQueryHandler[] = []
const afterResponseHandlers: AfterResponseHandler[] = []

export function registerBeforeQueryHook(handler: BeforeQueryHandler): Disposable {
  beforeQueryHandlers.push(handler)
  return {
    dispose() {
      const idx = beforeQueryHandlers.indexOf(handler)
      if (idx >= 0) beforeQueryHandlers.splice(idx, 1)
    },
  }
}

export function registerAfterResponseHook(handler: AfterResponseHandler): Disposable {
  afterResponseHandlers.push(handler)
  return {
    dispose() {
      const idx = afterResponseHandlers.indexOf(handler)
      if (idx >= 0) afterResponseHandlers.splice(idx, 1)
    },
  }
}

/** Run all before-query hooks in sequence. Returns the (possibly modified) context. */
export async function runBeforeQueryHooks(ctx: QueryHookContext): Promise<QueryHookContext> {
  let current = ctx
  for (const handler of beforeQueryHandlers) {
    current = await handler(current)
  }
  return current
}

/** Run all after-response hooks (fire-and-forget, errors logged). */
export async function runAfterResponseHooks(ctx: ResponseHookContext): Promise<void> {
  for (const handler of afterResponseHandlers) {
    try {
      await handler(ctx)
    } catch (err) {
      console.error('[plugin-hooks] Error in afterResponse handler:', err)
    }
  }
}
