# Session Await & Resume Runtime (v2)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. It defines the product-owned runtime that lets a chat session pause on an external condition and later resume the same session automatically.

**Supersedes**: `20260507-02-session-await-resume-runtime.md` (stale — references old `src/main/` Electron architecture).

## Product Goal

The user should not need to babysit external systems. After an agent reaches a natural pause point, it says "I am waiting for CI" and Cradle resumes the same session automatically when that condition becomes true.

## User Journey (Exact)

  1. 用户：推个 PR 吧，当 CI 搞定了之后，你就帮我合并吧
  2. Agent：好的。[推送 PR #42] [调用 `cradle session await-create --source github-ci --filter '{"repo":"...","pr":42}'`]
         好的，我已经推送了 PR，我会等 CI 通过后自动合并。
  3. Agent turn 结束，session 进入 AWAITING 状态（UI 显示等待徽章）
  4. Cradle 后台 poller 轮询 GitHub API，检查 PR #42 CI 状态
  5. CI 通过 → poller 构造 resume payload，调用 `ChatRuntime.createRun(sessionId, resumeText)`
  6. Agent 有完整历史上下文，执行 merge PR
  7. 循环直到 Agent 决定不再订阅（任务完成）

## Architecture Mapping (New vs Old)

| Concept | Old (`src/main/`) | New (`apps/server/`) |
|---------|-------------------|---------------------|
| Chat continuation | `chatEngine.send(sessionId, text)` | `ChatRuntime.createRun({ sessionId, text })` |
| Schema location | `src/main/db/schema/` | `packages/db/src/schema/` |
| Feature owner | `src/main/session-await/` | `apps/server/src/modules/session-await/` |
| CLI | `src/cli/index.ts` (manual) | `packages/cli/` (auto-generated from OpenAPI `x-cradle-cli`) |
| IPC adapter | `src/main/app/ipc/session-await.ts` | Not needed — HTTP routes serve CLI and frontend directly |
| Provider context | Environment variables via provider | System workflow + skill injection |

## Progress

- [x] (2026-05-13) Redesigned exec-plan for current `apps/server/` Elysia architecture
- [ ] M1: Schema + module skeleton + basic service
- [ ] M2: HTTP routes with `x-cradle-cli` metadata → auto CLI generation
- [ ] M3: Agent context injection (session identity in system prompt)
- [ ] M4: Frontend awaiting projection (badge in session list)
- [ ] M5: Background dispatcher (poller + source adapter registry)
- [ ] M6: GitHub CI/PR review source adapter
- [ ] M7: Issue-agent consumption

## Decision Log

- Decision: Module at `apps/server/src/modules/session-await/` following existing patterns (index.ts routes, model.ts, service.ts, types.ts).
  Rationale: All server modules follow this pattern. No DI container, direct imports, `db()` accessor.
  Date: 2026-05-13

- Decision: CLI auto-generated via `x-cradle-cli` route metadata.
  Rationale: All 22 existing CLI modules are auto-generated from OpenAPI spec. No manual CLI code needed.
  Date: 2026-05-13

- Decision: Session busy guard respected — poller must not call `createRun()` if `activeRunIdsBySession` has an entry.
  Rationale: `createRun()` already rejects with HTTP 409 if a run is in progress. Poller should check or retry with backoff.
  Date: 2026-05-13

- Decision: Awaiting state projected from `session_awaits` table, not added to `sessions` table.
  Rationale: `sessions` has no status field currently. Adding one would be invasive. A projection query keeps ownership clear.
  Date: 2026-05-13

- Decision: Agent registers awaits via CLI (`cradle session await-create`), same as all other Cradle actions.
  Rationale: Agents already use `cradle` CLI for all product actions (issues, tasks, etc). Skills teach the syntax.
  Date: 2026-05-13

## Plan of Work

### M1: Schema + Module Skeleton

**Create schema** at `packages/db/src/schema/session-await.ts`:

```ts
import { sql } from 'drizzle-orm'
import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sessions } from './chat'
import { textPk, createdAt, workspaces } from './shared'

export const sessionAwaits = sqliteTable('session_awaits', {
  id: textPk(),
  chatSessionId: text('chat_session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  source: text('source').notNull(), // e.g. 'manual', 'github-ci', 'github-review'
  filterJson: text('filter_json').notNull(), // source-specific filter
  status: text('status', { enum: ['pending', 'triggered', 'expired', 'cancelled', 'failed'] }).notNull().default('pending'),
  reason: text('reason'), // human-readable wait reason
  resumePayloadJson: text('resume_payload_json'),
  ...createdAt(),
  triggeredAt: int('triggered_at'), // unix epoch seconds
  expiresAt: int('expires_at'), // unix epoch seconds; null = no expiration
  fireAt: int('fire_at'), // unix epoch seconds; for timer-based waits
  lastCheckedAt: int('last_checked_at'), // unix epoch seconds
  lastErrorText: text('last_error_text'),
}, (table) => ([
  index('idx_session_awaits_status').on(table.status),
  index('idx_session_awaits_session').on(table.chatSessionId),
]))
```

**Create module** at `apps/server/src/modules/session-await/`:
- `types.ts` — SessionAwait, RegisterInput, TriggerInput, source adapter interface
- `service.ts` — register, cancel, trigger (idempotent), expire, listPending, getSessionSummary
- `model.ts` — TypeBox request/response schemas
- `index.ts` — Elysia routes

**Service core logic**:
- `register(input)` → insert pending row
- `cancel(awaitId)` → update status to cancelled (only if pending)
- `trigger(input)` → if already triggered, no-op; else mark triggered + call `ChatRuntime.createRun(sessionId, resumeText)`
- `getSessionSummary(sessionId)` → { awaiting: boolean, pendingCount, primarySource, reason }

### M2: HTTP Routes + CLI

Routes at prefix `/session-awaits`:

```
POST   /session-awaits                    — register a new await
GET    /session-awaits/:id                 — get await by id  
GET    /session-awaits?sessionId=...       — list awaits for a session
POST   /session-awaits/:id/cancel          — cancel a pending await
POST   /session-awaits/:id/trigger         — manually trigger (for testing/manual use)
GET    /session-awaits/summary?sessionId=... — projected awaiting state
POST   /session-awaits/webhook/:source     — external webhook trigger (event-based sources)
```

All routes get `x-cradle-cli` metadata with command paths like `['session', 'await-create']`, `['session', 'await-cancel']`, etc → CLI commands auto-generated on next `pnpm gen:cli`.

**Note**: The await-summary endpoint lives in the session-await module (not session module) to avoid cross-module ownership dependency.

### M3: Agent Context Injection

Agents need to know their own session ID to register awaits.

**Approach**: Inject `CRADLE_CHAT_SESSION_ID` and `CRADLE_WORKSPACE_ID` into the system prompt context block that all providers receive. This is already done for other context (workspace path, etc).

**Edit**: `apps/server/src/modules/chat-runtime/service.ts` — in the private `resolveTurnContext()` method (the one called by `createRun()`, not the standalone `resolve()` in `chat-turn-context.ts`), append session identity fields (`CRADLE_CHAT_SESSION_ID`, `CRADLE_WORKSPACE_ID`) to the system prompt context block.

**Skill update**: Add `await-create` / `await-cancel` commands to `resources/skills/cradle-cli/SKILL.md`.

**System workflow update**: Add a behavioral rule in `resources/system-workflow.md`:
> When you need to wait for an external condition (CI, review, deployment), register an await with `cradle session await-create` instead of polling yourself.

### M4: Frontend Awaiting Projection

**Backend**: Use `GET /session-awaits/summary?sessionId=...` endpoint (owned by session-await module) that returns `{ awaiting: boolean, pendingCount, primarySource, reason }`.

**Frontend**: In session list and active chat header, query the summary and display:
- "Waiting for GitHub CI on PR #42" badge when `awaiting = true`
- When `awaiting = true`, disable the chat input to prevent user messages from interrupting the await flow. Show a "Cancel wait" button instead.
- This can be a simple poll or included in session list response as a join.

### M5: Background Dispatcher

Create `apps/server/src/modules/session-await/poller.ts`:

- Register via `app.onStart()` in the module's `index.ts`, clear via `app.onStop()`
- Default interval 30s, but each source adapter can declare `pollIntervalMs` for customization
- Group pending awaits by source
- For each source, call registered `SessionAwaitSource.checkPending(awaits)` (batch API calls — e.g. one GitHub API call per PR, not per await)
- Process matched awaits **sequentially** with concurrency limit (e.g. max 3 concurrent `createRun()` calls via `p-limit`) to avoid overwhelming provider APIs
- If session is busy (409 from `createRun`), skip and retry next cycle
- Update `lastCheckedAt` on every check, `lastErrorText` on transient errors
- Respect expiration: auto-expire rows past `expiresAt`
- Handle timer-based waits: if `fireAt` is set and `fireAt <= now`, trigger immediately without calling source adapter
- Rate limit GitHub API calls: max 100 requests per poll cycle per source, group by repo

**Source adapter interface**:
```ts
export interface SessionAwaitSource {
  source: string
  pollIntervalMs?: number // default 30000
  checkPending(awaits: SessionAwait[]): Promise<CheckResult[]>
}

interface CheckResult {
  awaitId: string
  matched: boolean
  resumeText?: string
  resumePayloadJson?: string
  transientError?: string
}
```

### M6: GitHub Source Adapter

`apps/server/src/modules/session-await/sources/github-ci.ts`:
- Reads GitHub token from secrets store
- Polls GitHub REST API for check runs on a PR
- Filter shape: `{ repo: "owner/repo", pr: number, requiredChecks?: string[] }`
- When all checks pass: `matched = true`, `resumeText = "CI passed: [check names]. Proceed with merge."`

`apps/server/src/modules/session-await/sources/github-review.ts`:
- Similar, polls PR review state
- Filter: `{ repo, pr, requiredApprovals?: number }`

### M7: Issue-Agent Consumption

When issue-agent creates a session and the agent registers an await, it "just works" because the await is session-owned, not issue-owned. The issue panel can query await-summary for linked sessions and display the badge.

## Concrete Steps (Implementation Order)

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. **Schema**: Create `packages/db/src/schema/session-await.ts`, export from `packages/db/src/schema/index.ts`, generate migration with `pnpm drizzle-kit generate`.

2. **Module skeleton**: Create `apps/server/src/modules/session-await/{types,service,model,index}.ts`. Wire into `apps/server/src/app.ts`.

3. **Tests**: Create `apps/server/tests/session-await.test.ts` — test register, cancel, trigger idempotency, session-busy handling.

4. **Agent context**: Inject session ID into system prompt in chat-runtime. Update skill and workflow docs.

5. **Frontend badge**: Add await-summary endpoint, query from frontend, display in session list.

6. **Poller**: Add background poller with manual source first (for testing).

7. **GitHub adapter**: Implement after generic runtime works.

**Validation**:
```bash
cd apps/server && pnpm test && pnpm typecheck && pnpm build
cd ../.. && pnpm typecheck
```

## Validation and Acceptance

- Agent can call `cradle session await-create` and get a pending await row
- Session list shows "Awaiting" badge for sessions with pending awaits
- Manual trigger resumes the session with `createRun()`
- Second trigger on same await is a no-op (idempotent)
- Poller respects session-busy guard (skips if 409)
- GitHub adapter polls and triggers when CI passes (later milestone)

## Interfaces

```ts
// packages/db/src/schema/session-await.ts
export const sessionAwaits = sqliteTable('session_awaits', { ... })

// apps/server/src/modules/session-await/types.ts
export interface SessionAwait { ... }
export interface RegisterInput { chatSessionId, workspaceId, source, filterJson, reason?, expiresAt? }
export interface TriggerInput { awaitId, resumeText, resumePayloadJson? }
export interface SessionAwaitSummary { awaiting, pendingCount, primarySource, reason }
export interface SessionAwaitSource { source, checkPending(awaits) }
```
