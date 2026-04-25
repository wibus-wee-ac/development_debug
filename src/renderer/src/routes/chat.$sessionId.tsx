// Input: ipc for pre-fetching session + messages, TanStack Router
// Output: /chat/$sessionId route config — loader, search validation, cache policy
// Position: Critical-path route definition; component lives in chat.$sessionId.lazy.tsx

import { ipc } from '@renderer/lib/ipc'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/chat/$sessionId')({
  validateSearch: (search: Record<string, unknown>) => ({
    tearoff: search.tearoff === 'true' || search.tearoff === true,
  }),
  /**
   * Pre-fetch both session metadata and messages before the route renders.
   * Both IPC calls run in parallel so the total wait is max(session, messages).
   * TanStack Router blocks navigation until the loader resolves — the previous
   * route stays visible — then renders the new route with all data already
   * available: no spinner, no empty-state flash.
   */
  loader: async ({ params }) => {
    if (!ipc) {
      return { session: undefined, messages: [], agent: undefined }
    }
    const [session, messages] = await Promise.all([
      ipc.session.get(params.sessionId),
      ipc.chat.getMessages(params.sessionId),
    ])
    return { session, messages }
  },
  // Keep loader data fresh for 5 minutes; quick session-switching inside that
  // window reuses the cache without an extra IPC round-trip.
  staleTime: 5 * 60 * 1_000,
  gcTime: 10 * 60 * 1_000,
})
