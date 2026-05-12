// Input: observability contract input type
// Output: thin observability sink port with a noop default implementation
// Position: dependency boundary used by server producers to avoid hard store coupling

import type { CreateEventInput } from './contract'

export interface ObservabilitySink {
  record: (input: CreateEventInput) => void
}

export const noopObservabilitySink: ObservabilitySink = {
  record: () => {},
}
