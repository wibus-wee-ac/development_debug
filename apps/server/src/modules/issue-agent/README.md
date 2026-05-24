# Issue Agent Module

Provides server-owned issue delegation, agent identity binding, agent session tracking, activity timeline projection, rerun, undelegation semantics, and a thin continuation bridge into Chat Runtime.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.
The continuation bridge records Issue Agent activity and session status for visibility, but queue state is owned by Chat Runtime in `chat_session_queue_items`. Issue Agent reads Chat Runtime queue/run state to keep delegated Agent Sessions active while queued continuations drain, and stop/undelegate cancels the linked Chat Session run plus pending queue items instead of writing Issue Agent-owned queue state.

## Files

- `index.ts`: Elysia routes for issue delegation, issue-agent sessions, and the UI-only continuation bridge.
- `model.ts`: TypeBox schemas for delegation state, session views, activity views, continuation requests, params, and bodies.
- `service.ts`: delegation semantics, unified issue assignee synchronization, agent identity resolution, issue prompts with stable issue IDs, chat-runtime completion subscription for agent run status, continuation watcher status projection, stop/undelegate cancellation of linked Chat Runtime work, and activity recording for Chat Runtime continuations.
