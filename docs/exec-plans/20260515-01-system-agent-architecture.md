# System Agent — Architecture & Integration Plan

## Overview

Cradle's System Agent is an AI agent that has full awareness of what the user is seeing and doing in the application, and can operate Cradle on the user's behalf. It is powered by [HiJarvis](https://github.com/user/HiJarvis) (`@hijarvis/jar-core`) as the agent runtime, with Cradle providing context, tools, and memory via a HiJarvis Plugin.

## Core Principles

1. **Context goes BEFORE user message** — Never in system prompt (breaks KV cache)
2. **Cradle wraps HiJarvis** — HiJarvis is a library dependency, not a standalone service
3. **Plugin-based integration** — All Cradle-specific concerns live in a single HiJarvis plugin
4. **Config owned by Cradle** — Provider/secret config uses Cradle's profile system, not `jar.toml`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Cradle Web Client                                           │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │ useCradleTabStore   │    │ useChatStore             │   │
│  │ useLayoutStore      │───▶│ useNewChatStore          │   │
│  │ useSessionActivity  │    │ collectContextSnapshot() │   │
│  └─────────────────────┘    └──────────┬───────────────┘   │
│                                        │                    │
│                              POST /system-agent/context     │
│                                        │                    │
└────────────────────────────────────────┼────────────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────┐
│ Cradle Server                          ▼                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ system-agent module                                  │   │
│  │                                                      │   │
│  │  POST /system-agent/context  → stores latest snap    │   │
│  │  GET  /system-agent/context  → returns latest snap   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                         │                    │
│                                         ▼                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ @hijarvis/jar-core (library import)                  │   │
│  │                                                      │   │
│  │  executeIngressCommand({                             │   │
│  │    config,                                           │   │
│  │    command: { kind: 'message', ... },                │   │
│  │    hooks: cradleHooks,                               │   │
│  │    pluginOverrides                                   │   │
│  │  })                                                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                         │                    │
│  ┌──────────────────────────────────────┼───────────────┐   │
│  │ @cradle/jar-plugin-cradle            ▼               │   │
│  │                                                      │   │
│  │  hooks['ingress:before'] → prepend context to msg    │   │
│  │  memoryProvider → CradleDBMemory                     │   │
│  │  tools → [cradleCLITool]                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Context Collection

### Schema (`apps/web/src/features/system-agent/context-schema.ts`)

```typescript
interface SystemAgentContext {
  activeTab: { type: string; params: Record<string, string>; label: string } | null
  openTabs: Array<{ type: string; label: string }>
  chatContext: {
    sessionId: string
    status: 'idle' | 'streaming' | 'error'
    messageCount: number
    recentMessages: Array<{ role: string; contentPreview: string }>
  } | null
  layout: { sidebarCollapsed, asideOpen, asideActiveTab, bottomPanelOpen, isSettings, settingsSection }
  activeProfileId: string | null
  unreadSessionIds: string[]
}
```

### Collector (`apps/web/src/features/system-agent/use-context-snapshot.ts`)

`collectContextSnapshot()` — imperative function that reads all Zustand stores and returns a `SystemAgentContext`. Not reactive, called on-demand.

### Report (`apps/web/src/features/system-agent/report-context.ts`)

`reportContext()` — POSTs the snapshot to `/system-agent/context`. Called:
- Before each message to System Agent (preflight)
- On significant navigation events (tab switch, etc.) — optional for freshness

### Server Storage (`apps/server/src/modules/system-agent/`)

- In-memory latest snapshot (no DB persistence needed — context is ephemeral)
- `POST /system-agent/context` — web client reports
- `GET /system-agent/context` — plugin reads during agent execution

## Context Injection (via HiJarvis Plugin)

Context is injected **before the user message** using the `ingress:before` transform hook:

```typescript
hooks.on('ingress:before', (command) => {
  if (command.kind === 'message') {
    const snapshot = await fetch(serverUrl + '/system-agent/context').then(r => r.json())
    const contextBlock = formatContextForAgent(snapshot)
    command.message.text = `${contextBlock}\n\n${command.message.text}`
  }
  return command
})
```

This keeps the system prompt stable (cacheable) while giving the agent fresh context every turn.

## Context Formatter

The formatter converts `SystemAgentContext` into a concise text block the agent can understand:

```
<cradle_context>
Active: Chat session "Feature discussion" (streaming)
Open tabs: Home, Chat "Feature discussion", Kanban Board
Recent messages: 3 messages (user → assistant → user)
Layout: sidebar open, aside closed, settings closed
Profile: profile-abc-123
Unread: 2 sessions
</cradle_context>
```

## Agent Tools

### Primary: Cradle CLI (`cradleCLITool`)

The agent operates Cradle via the CLI (`cradle` binary), which covers:
- Session management (create, list, messages, export)
- Issue/Kanban operations (create, update, delegate)
- Workspace/file operations (read, write, pack)
- Git operations (status, branches, checkout)
- Provider management (models, health-check)
- Skills (list, export, import)
- Approvals (list, respond)

This gives the agent 1:1 parity with what the user can do.

### Implementation via Bash tool

HiJarvis already has a `Bash` tool. The agent simply executes:
```bash
cradle session list
cradle issue create --title "..." --description "..."
cradle workspace file read --path "src/main.ts"
```

No special tool wrapper needed — just ensure `cradle` CLI is in PATH.

## Memory (via Plugin `memoryProvider`)

HiJarvis Plugin's `install()` can return `memoryProvider` to override the default file-system memory.

### CradleDBMemoryProvider

Implements HiJarvis's `MemoryProvider` interface backed by Cradle's SQLite DB:

```typescript
interface MemoryProvider {
  search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]>
  store(entry: { content: string; metadata?: Record<string, unknown> }): Promise<string>
  update(id: string, entry: Partial<MemoryEntry>): Promise<void>
  delete(id: string): Promise<void>
}
```

**DB table:** `system_agent_memory`
- `id` TEXT PRIMARY KEY
- `content` TEXT NOT NULL
- `metadata` TEXT (JSON)
- `embedding` BLOB (future: vector search)
- `created_at` INTEGER
- `updated_at` INTEGER

**Scoped by:** entity/surface (agent identity within Cradle)

## Provider Config

HiJarvis normally reads `jar.toml` for provider config. In Cradle integration:
- **Cradle's profile system** provides the API key and model selection
- The plugin constructs a `LoadedRuntimeConfig` from Cradle's profiles/secrets at execution time
- No `jar.toml` file needed

```typescript
function buildJarConfig(profile: AgentProfile, secret: string): LoadedRuntimeConfig {
  return {
    provider: {
      [profile.providerKind]: {
        api_key: secret,
        base_url: profile.configJson.baseUrl,
        model: profile.configJson.model,
      }
    },
    // ... other config from Cradle's preferences
  }
}
```

## Streaming to Frontend

HiJarvis emits events via `execution.onEvent` callback or the `agent:event` tap hook:

```typescript
hooks.on('agent:event', (event) => {
  // event.type: 'text-delta' | 'tool-call' | 'tool-result' | 'thinking' | ...
  // Forward to Cradle's SSE streaming
  sseEmitter.emit(sessionId, event)
})
```

This maps to Cradle's existing chat streaming infrastructure (SSE → `useChatStore`).

## Implementation Status

| Component | Status | Location |
|-----------|--------|----------|
| Context Schema | ✅ Done | `apps/web/src/features/system-agent/context-schema.ts` |
| Context Collector | ✅ Done | `apps/web/src/features/system-agent/use-context-snapshot.ts` |
| Context Reporter | ✅ Done | `apps/web/src/features/system-agent/use-system-agent-chat.ts` (reports before each message) |
| Server Module | ✅ Done | `apps/server/src/modules/system-agent/` |
| Context Formatter | ✅ Done | `apps/server/src/modules/system-agent/format-context.ts` |
| HiJarvis Integration | ✅ Done | `apps/server/src/modules/system-agent/service.ts` (jar-core linked) |
| Event Bridge | ✅ Done | `service.ts` → `bridgeEventToChunks()` (AgentEvent → UIMessageChunk) |
| Frontend Chat Hook | ✅ Done | `apps/web/src/features/system-agent/use-system-agent-chat.ts` |
| Cradle Plugin | ⏳ Next | Context injection via hook, CLI tool, memory provider |
| DB Memory Provider | ⏳ Next | Waiting for stable jar-core memory interface |
| Streaming Bridge | ✅ Done | SSE in `StoredChunk` format, consumed by existing frontend |

## Future Considerations

- **Multi-surface**: System Agent could manifest in different tabs (chat, kanban assistant, etc.)
- **Proactive triggers**: Agent could watch for events (new issue assigned, build failure) and act
- **Tool approval**: Cradle's existing approval system can gate destructive CLI commands
- **Cost tracking**: All agent execution goes through Cradle's usage module
