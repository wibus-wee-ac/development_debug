/** Minimal interface — only `invoke` is required for the proxy. */
interface InvokableIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createIpcProxy<IpcServices extends Record<string, any>>(
  ipc: InvokableIpc | null
): IpcServices | null {
  if (!ipc) return null

  return new Proxy({} as IpcServices, {
    get(_target, groupName: string) {
      return new Proxy(
        {},
        {
          get(_, methodName: string) {
            return (...args: unknown[]) => {
              return ipc.invoke(`${groupName}.${methodName}`, ...args)
            }
          },
        }
      )
    },
  })
}
