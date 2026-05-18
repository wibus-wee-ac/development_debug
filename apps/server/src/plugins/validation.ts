export class PluginLoadError extends Error {
  constructor(
    public readonly pluginName: string,
    message: string,
  ) {
    super(`[plugin:${pluginName}] ${message}`)
    this.name = 'PluginLoadError'
  }
}

export function validatePluginModule(
  mod: unknown,
  pluginName: string,
  layer: 'server' | 'desktop' | 'web',
): asserts mod is { activate: Function; deactivate?: Function } {
  if (mod === null || typeof mod !== 'object') {
    throw new PluginLoadError(pluginName, `${layer} entry did not export a module object. Got: ${typeof mod}`)
  }
  const m = mod as Record<string, unknown>
  if (typeof m.activate !== 'function') {
    const exported = Object.keys(m).join(', ')
    throw new PluginLoadError(pluginName, `${layer} entry does not export 'activate' function. Got exports: [${exported}]`)
  }
  if ('deactivate' in m && typeof m.deactivate !== 'function') {
    throw new PluginLoadError(pluginName, `${layer} entry exports 'deactivate' but it's not a function (got ${typeof m.deactivate})`)
  }
}
