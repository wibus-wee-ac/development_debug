import { HostMetrics } from '@opentelemetry/host-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { trace } from '@opentelemetry/api'

import { getTelemetryConfig } from './config'
import { createMetricReaders, createTraceSpanProcessors } from './exporters'
import { createTelemetryInstrumentations } from './instrumentation'
import { bindLangfuseTracerProvider } from './langfuse'
import { initializeCradleMetrics } from './metrics'
import { createTelemetryResource } from './resource'
import { startRuntimeMetricSampler, stopRuntimeMetricSampler } from './runtime-sampler'

let sdk: NodeSDK | null = null
let hostMetrics: HostMetrics | null = null
let initialized = false

function logTelemetry(message: string): void {
  process.stderr.write(`[telemetry] ${message}\n`)
}

export function initializeTelemetry(): void {
  if (initialized) {
    return
  }
  initialized = true

  const config = getTelemetryConfig()
  if (!config.enabled) {
    bindLangfuseTracerProvider(null)
    logTelemetry('OpenTelemetry disabled (set CRADLE_OTEL_ENABLED=1 to enable)')
    return
  }

  const spanProcessors = createTraceSpanProcessors(config)
  const metricReaders = createMetricReaders(config)

  sdk = new NodeSDK({
    resource: createTelemetryResource(config),
    spanProcessors,
    metricReaders,
    instrumentations: createTelemetryInstrumentations(config),
  })
  sdk.start()
  bindLangfuseTracerProvider(trace.getTracerProvider())

  if (config.metricsEnabled) {
    initializeCradleMetrics()
    hostMetrics = new HostMetrics()
    hostMetrics.start()
    startRuntimeMetricSampler(config)
  }

  logTelemetry(`OpenTelemetry enabled service=${config.serviceName} traces=${config.tracesEnabled} metrics=${config.metricsEnabled}`)
  logTelemetry(config.langfuseEnabled ? 'Langfuse exporter enabled' : 'Langfuse exporter disabled')
  if (config.prometheusEnabled) {
    logTelemetry(`Prometheus metrics enabled http://${config.prometheusHost ?? '0.0.0.0'}:${config.prometheusPort}${config.prometheusEndpoint}`)
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    return
  }
  try {
    await sdk.shutdown()
  }
  finally {
    stopRuntimeMetricSampler()
    bindLangfuseTracerProvider(null)
    sdk = null
    hostMetrics = null
  }
}
