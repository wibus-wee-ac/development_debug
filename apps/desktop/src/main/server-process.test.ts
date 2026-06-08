import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp/cradle-user-data'),
    getVersion: vi.fn(() => '0.0.1-test'),
  },
  dialog: {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
  },
}))

vi.mock('electron', () => electronMocks)

describe('desktop server process observability env', () => {
  it('passes telemetry, exporter, and diagnostics env to the server child process', async () => {
    const { pickDesktopServerObservabilityEnv } = await import('./server-process')

    expect(pickDesktopServerObservabilityEnv({
      CRADLE_OTEL_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_PORT: '9464',
      CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token',
      CRADLE_LANGFUSE_ENABLED: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      CRADLE_DIAGNOSTICS_TOKEN: 'local-token',
      CRADLE_HOST: '0.0.0.0',
      CRADLE_DATA_DIR: '/tmp/other-data',
      EMPTY_VALUE: '',
    })).toEqual({
      CRADLE_OTEL_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_PORT: '9464',
      CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token',
      CRADLE_LANGFUSE_ENABLED: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      CRADLE_DIAGNOSTICS_TOKEN: 'local-token',
    })
  })

  it('ignores blank observability values', async () => {
    const { pickDesktopServerObservabilityEnv } = await import('./server-process')

    expect(pickDesktopServerObservabilityEnv({
      CRADLE_OTEL_ENABLED: '   ',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
    })).toEqual({
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
    })
  })
})
