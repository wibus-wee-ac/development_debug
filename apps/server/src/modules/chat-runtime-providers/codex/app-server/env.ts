import type { CodexAppServerAuthResolution } from './chatgpt-auth'
import { buildCodexAuthEnvironment } from '../config/runtime-config'
import { buildCradleCodexAppServerEnv } from './client'

export function buildCodexAppServerEnv(
  input: Parameters<typeof buildCradleCodexAppServerEnv>[0],
  auth: CodexAppServerAuthResolution,
): Record<string, string> {
  return {
    ...buildCradleCodexAppServerEnv(input),
    ...buildCodexAuthEnvironment(auth),
  }
}
