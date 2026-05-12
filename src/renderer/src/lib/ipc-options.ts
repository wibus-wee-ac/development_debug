// Input: renderer runtime mode and current location hash
// Output: whether IPC calls should capture expensive caller stack traces
// Position: Renderer IPC instrumentation policy; keeps default UI calls cheap outside the dedicated devtool route

export function shouldCaptureIpcStack(input: { isDev: boolean, hash: string }): boolean {
  if (!input.isDev) {
    return false
  }

  return input.hash === '#/devtool' || input.hash.startsWith('#/devtool?')
}
