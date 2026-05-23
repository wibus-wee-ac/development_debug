# server-events

Push-based SSE channel for server status events.

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/server/events` | SSE stream of server status events |

## Event Types

- `source_sync_error` — an external provider source failed to sync
- `daemon_error` — a background daemon (chronicle, slack) failed

## Usage

Connect with `EventSource` from the client:

```ts
const es = new EventSource('/server/events')
es.onmessage = (e) => {
  const event = JSON.parse(e.data)
  // event.type === 'source_sync_error' | 'daemon_error'
}
```

## Owner

`server-events` module owns this namespace. Other modules publish events via `serverEventBus.publish()`.
