// Input: VITE_SERVER_URL env var or default to localhost:21423
// Output: configured fetch client for apps/server API
// Position: apps/web/src/lib/client.config.ts — runtime config consumed by hey-api generated client

import type { createConfig } from '../api-gen/client'
import { createClient } from '../api-gen/client'

// createClientConfig is called by the generated code to inject per-request config.
// Return a config object that merges baseUrl into every request.
export function createClientConfig(config: Parameters<typeof createConfig>[0]) {
  return {
    ...config,
    baseUrl: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:21423',
  }
}

// Also export a ready-made client instance for direct SDK calls.
export const client = createClient(createClientConfig({}))
