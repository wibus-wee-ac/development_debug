import { LangfuseSpanProcessor } from '@langfuse/otel'
import { setLangfuseTracerProvider } from '@langfuse/tracing'
import { trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

import { createChildLogger } from './logging/logger'

const logger = createChildLogger({ module: 'langfuse' })

/**
 * Whether Langfuse tracing is enabled (credentials are set and not in test env).
 */
export const langfuseEnabled = !!(
  process.env.LANGFUSE_PUBLIC_KEY
  && process.env.LANGFUSE_SECRET_KEY
  && process.env.NODE_ENV !== 'test'
)

if (langfuseEnabled) {
  const provider = new BasicTracerProvider({
    spanProcessors: [new LangfuseSpanProcessor()],
  })
  trace.setGlobalTracerProvider(provider)
  setLangfuseTracerProvider(provider)
  logger.info('Langfuse tracing enabled', {
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  })
}
else {
  logger.info('Langfuse tracing disabled (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set)')
}
