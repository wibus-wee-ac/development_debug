# Slack Conversation Bridge

This bundled plugin provides the Slack adapter for the server-owned `conversation-bridge` module.

The plugin owns Slack protocol behavior only: Socket Mode startup, Slack event normalization, mention cleanup, Block Kit rendering, and `chat.postMessage` delivery. It does not store bridge rows, bind channels, create Cradle sessions, or call Cradle HTTP APIs. Those semantics live in `apps/server/src/modules/conversation-bridge`.

Connection secrets are resolved by the server bridge supervisor and passed to this adapter as plaintext only at runtime. A Slack connection expects these secret keys:

- `botToken`: Slack bot token used by Web API calls.
- `appToken`: Slack app-level token used for Socket Mode.
- `signingSecret`: Slack signing secret required by Bolt.

Connection config may include `logLevel` with `debug`, `info`, `warn`, or `error`.
