# Claude Agent Runtime Provider

Owns the Claude Agent SDK adapter for Chat Runtime. This provider translates Cradle `UIMessage` turns into Claude Agent SDK streaming input and maps SDK output back into AI SDK `UIMessageChunk` events.

Selected chat Skills arrive as Cradle-owned `data-cradle-skill` message parts. The provider removes them from the text/image input blocks and merges their names into Claude Agent SDK `queryOptions.skills` unless the profile already enables `skills: "all"`.

Claude session titles are read from SDK session metadata with `getSessionInfo()` after a provider session id is known, then reported through Chat Runtime's title callback. Cradle owns the final `sessions.title` write.

## Files

- `provider.ts`: Claude Agent `ChatRuntime` implementation; starts/resumes SDK sessions, projects SDK session titles to Chat Runtime, forwards MCP servers, streams turns, and handles live steering/cancellation/permission mode changes.
- `provider.test.ts`: Regression tests for Claude Agent SDK options, title projection, MCP forwarding, history projection, streaming, steering, attachments, and tool chunk mapping.
- `mapper.ts`: Maps Claude Agent SDK messages into AI SDK `UIMessageChunk` events.
- `mapper.test.ts`: Mapper-level regression tests.
- `tools/`: Claude Code tool identity, todo state projection, and tool envelope mapping.
