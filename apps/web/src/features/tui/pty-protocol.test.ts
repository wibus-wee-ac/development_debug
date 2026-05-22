import { describe, expect, it } from 'vitest'

import { PtyServerEventSchema } from './pty-protocol'

describe('PtyServerEventSchema', () => {
  it('parses snapshot, output, pong, and error events', () => {
    expect(PtyServerEventSchema.parse({
      type: 'snapshot',
      seq: 7,
      buffer: 'ready',
      running: true,
    })).toEqual({
      type: 'snapshot',
      seq: 7,
      buffer: 'ready',
      running: true,
    })

    expect(PtyServerEventSchema.parse({
      type: 'output',
      seq: 8,
      data: 'hello',
    })).toEqual({
      type: 'output',
      seq: 8,
      data: 'hello',
    })

    expect(PtyServerEventSchema.parse({ type: 'pong' })).toEqual({ type: 'pong' })

    expect(PtyServerEventSchema.parse({
      type: 'error',
      code: 'terminal_not_found',
      message: 'Terminal not found',
    })).toEqual({
      type: 'error',
      code: 'terminal_not_found',
      message: 'Terminal not found',
    })
  })

  it('parses exit events with concrete and nullable exit fields', () => {
    expect(PtyServerEventSchema.parse({
      type: 'exit',
      seq: 9,
      exitCode: 0,
      signal: 'SIGTERM',
    })).toEqual({
      type: 'exit',
      seq: 9,
      exitCode: 0,
      signal: 'SIGTERM',
    })

    expect(PtyServerEventSchema.parse({
      type: 'exit',
      seq: 10,
      exitCode: null,
      signal: null,
    })).toEqual({
      type: 'exit',
      seq: 10,
      exitCode: null,
      signal: null,
    })
  })

  it('throws for invalid JSON, unknown event types, and invalid required fields', () => {
    expect(() => JSON.parse('{')).toThrow()
    expect(() => PtyServerEventSchema.parse(null)).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'unknown' })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'snapshot', seq: 1, buffer: 'ready' })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'snapshot', seq: 1, buffer: 123, running: true })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'snapshot', seq: 1, buffer: 'ready', running: 'yes' })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'output', seq: '1', data: 'ready' })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'output', seq: 1, data: 123 })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'exit', exitCode: 0, signal: null })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'exit', seq: '1', exitCode: 0, signal: null })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'exit', seq: 1, exitCode: '0', signal: null })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'exit', seq: 1, exitCode: 0, signal: 15 })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'exit', seq: 1 })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'error', code: 'x' })).toThrow()
    expect(() => PtyServerEventSchema.parse({ type: 'error', code: 123, message: 'failed' })).toThrow()
  })
})
