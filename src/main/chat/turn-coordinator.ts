// Input: Provider streamTurn AsyncGenerator and cancellation signal
// Output: Pure async generator that yields TimelineInputEvent with bookend lifecycle events
// Position: Chat feature streaming coordinator — drives provider without DB/broadcast knowledge

import type { ChatRuntimeProvider, ProviderKind, StreamTurnInput } from '../agent-runtime/runtime-provider-types'
import type { TimelineInputEvent } from '../backend-control-plane/timeline-events'

export interface TurnCoordinatorInput {
  provider: ChatRuntimeProvider
  streamInput: StreamTurnInput
  providerKind: string
  /** AbortController signal — caller aborts when user cancels. */
  signal: AbortSignal
}

export interface TurnCoordinatorResult {
  status: 'complete' | 'aborted' | 'failed'
  errorText: string | null
}

export type TurnYield =
  | { type: 'delta', event: TimelineInputEvent }
  | { type: 'terminal', event: TimelineInputEvent }

/**
 * Drives the provider's streamTurn() generator and yields each TimelineInputEvent.
 * Emits synthetic `run.started` before the stream and `run.completed|aborted|failed` after.
 *
 * This function has ZERO side-effects: no DB, no broadcast, no search.
 * It is pure event transport.
 */
export async function* coordinateTurn(
  input: TurnCoordinatorInput,
): AsyncGenerator<TurnYield, TurnCoordinatorResult, undefined> {
  const { provider, streamInput, providerKind, signal } = input

  // Bookend: run.started
  yield {
    event: {
      type: 'run.started',
      source: {
        backend: providerKind as ProviderKind,
        eventType: 'chat.turn.started',
        metadata: {},
      },
    },
    type: 'delta',
  }

  let finalStatus: 'complete' | 'aborted' | 'failed' = 'complete'
  let finalError: string | null = null

  try {
    for await (const event of provider.streamTurn(streamInput)) {
      // Check for cancellation between yields
      if (signal.aborted) {
        finalStatus = 'aborted'
        break
      }
      yield { event, type: 'delta' }
    }

    // If loop ended cleanly but signal was aborted during last yield
    if (signal.aborted) {
      finalStatus = 'aborted'
    }
  }
  catch (err) {
    finalStatus = signal.aborted ? 'aborted' : 'failed'
    if (!signal.aborted) {
      finalError = serializeError(err)
    }
  }

  // Bookend: terminal event
  const terminalEvent: TimelineInputEvent = buildTerminalEvent(finalStatus, finalError, providerKind)
  yield { event: terminalEvent, type: 'terminal' }

  return { status: finalStatus, errorText: finalError }
}

function buildTerminalEvent(
  status: 'complete' | 'aborted' | 'failed',
  errorText: string | null,
  providerKind: string,
): TimelineInputEvent {
  const source = {
    backend: providerKind as ProviderKind,
    eventType: `chat.turn.${status}`,
  }

  switch (status) {
    case 'complete':
      return { type: 'run.completed', source }
    case 'aborted':
      return { type: 'run.aborted', source }
    case 'failed':
      return { type: 'run.failed', error: errorText ?? 'unknown error', source }
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as unknown as Record<string, unknown>).code
    const codePrefix = code !== undefined ? `[code ${String(code)}] ` : ''
    return `${codePrefix}${err.message}`
  }
  return String(err)
}
