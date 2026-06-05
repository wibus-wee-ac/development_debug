# Claude Agent Runtime Provider

Owns the Claude Agent SDK adapter for Chat Runtime. This provider translates Cradle `UIMessage` turns into Claude Agent SDK streaming input and maps SDK output back into AI SDK `UIMessageChunk` events.

Selected chat Skills arrive as Cradle-owned `data-cradle-skill` message parts. The provider removes them from the text/image input blocks and merges their names into Claude Agent SDK `queryOptions.skills` unless the profile already enables `skills: "all"`.

Claude session titles are read from SDK session metadata with `getSessionInfo()` after a provider session id is known, then reported through Chat Runtime's title callback. Cradle owns the final `sessions.title` write.
SDK disk persistence is disabled with `persistSession: false` because Cradle owns chat history in `sessions` / `messages`; Claude Agent provider sessions should not write new JSONL files into the user's `~/.claude/projects` import source.

Agent-scoped Claude Agent sessions use `~/.cradle/agents/{agentId}` as SDK `cwd`. The original project workspace remains explicit through SDK `additionalDirectories` and `CRADLE_WORKSPACE_PATH`; agent context is also passed through `CRADLE_AGENT_ID` and `CRADLE_AGENT_HOME`. The agent home is initialized by the Skills module, including `.agents/skills` and `.claude/skills` links to the Cradle-owned agent `skills/` directory.

Because SDK disk persistence is disabled, stored Cradle chats start fresh Claude Agent SDK sessions and replay bounded Cradle-owned history into the next prompt. The provider does not pass SDK `resume` for persisted Cradle chats because the SDK documents `persistSession: false` sessions as non-resumable.

Stored turns pass the resolved model through SDK query options and model alias environment variables instead of live `setModel()` on a resumed SDK session.

## Files

- `provider.ts`: Claude Agent `ChatRuntime` implementation; starts SDK sessions from Cradle-owned history, resolves agent-scoped runtime cwd, projects SDK session titles to Chat Runtime, forwards MCP servers, streams turns, and handles live steering/cancellation/permission mode changes.
- `provider.test.ts`: Regression tests for Claude Agent SDK options, title projection, MCP forwarding, history projection, streaming, steering, attachments, model switching, and tool chunk mapping.
- `metadata.ts`: Claude Agent runtime kind, catalog metadata, static capabilities, and slash-command presentation projection.
- `types.ts`: Claude Agent provider-private content and session-info types shared by package modules.
- `runtime-context.ts`: Resolves per-session Claude Agent cwd, agent home, project workspace path, and SDK additional directories.
- `input-projector.ts`: Projects Cradle message input, history, selected Skills, provider config, and environment into Claude Agent SDK content and query options.
- `async-input-stream.ts`: Claude Agent SDK async user-message input stream built on shared provider queue infrastructure.
- `state-projector.ts`: Projects Claude Agent provider snapshot state such as pending resumed-session model switches.
- `event-to-chunk-mapper.ts`: Maps Claude Agent SDK messages into AI SDK `UIMessageChunk` events.
- `subagent-projector.ts`: Projects forwarded subagent chunk streams into nested Cradle subagent output tool payloads.
- `event-to-chunk-mapper.test.ts`: Mapper-level regression tests.
- `tools/`: Claude Code tool identity, todo state projection, and tool envelope mapping.
