# System Prompt & Skills Injection for OpenAI-Compatible Provider

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `PLANS.md` at `.agents/skills/execplan/references/PLANS.md`.


## Purpose / Big Picture

After this change, when a user chats through an OpenAI-compatible provider in Cradle:

1. The LLM receives the full conversation history (all prior user/assistant messages), not just the current turn. Multi-turn conversations actually work.
2. If the Agent identity has a system prompt configured in `configJson`, the LLM receives it as a `{role: 'system'}` message.
3. If skills exist in the workspace's `.agents/skills/` or `~/.agents/skills/`, a skill catalog is appended to the system prompt so the LLM knows what skills are available and can read them via file-read.

ACP provider is unaffected — it manages its own session state and skills.

**How to verify**: Start Cradle, create an Agent with a system prompt in configJson (e.g. `{"systemPrompt": "You are a pirate."}`), start a chat, send two messages. The LLM should respond in pirate style and remember the first message.


## Progress

- [ ] Milestone 1: History + system prompt injection into StreamTurnInput
- [ ] Milestone 2: Skills catalog scanning and injection
- [ ] Milestone 3: Agent management UI for system prompt editing
- [ ] Milestone 4: Validation


## Surprises & Discoveries

（待实施时记录）


## Decision Log

- Decision: Extend `StreamTurnInput` with `systemPrompt` and `history` fields rather than making providers query DB themselves
  Rationale: Provider 不应直接访问 DB。ChatEngine 是唯一了解 session 完整上下文的组件，由它组装 context 传给 provider 是最干净的边界。不需要 prop drilling — ChatEngine.runStream() 通过 `draft.chatSessionId` 查 DB 即可获取所有需要的信息。
  Date: 2026-04-27

- Decision: ACP provider 忽略 systemPrompt 和 history 字段
  Rationale: ACP agent 进程自行管理会话状态和 skills。Cradle 不干预。
  Date: 2026-04-27

- Decision: Skills 激活依赖 file-read，不添加 activate_skill tool
  Rationale: 用户明确要求。OpenAI-compatible provider 的 LLM 通过读取 SKILL.md 文件路径来加载 skill 内容，与 agentskills.io 规范的 "file-read activation" 路径一致。
  Date: 2026-04-27

- Decision: Skills 扫描范围为 workspace `.agents/skills/` + `~/.agents/skills/`，project-level 优先
  Rationale: 遵循 agentskills.io 的 project-level > user-level 优先级约定。
  Date: 2026-04-27

- Decision: 历史消息从 `messages` 表加载，仅取 `status = 'complete'` 的行
  Rationale: streaming/aborted/failed 状态的消息不完整，不应发给 LLM。
  Date: 2026-04-27


## Outcomes & Retrospective

（待完成时记录）


## Context and Orientation

### 消息流现状

Cradle 的 chat 通过三层流转：

1. **ChatEngine**（`src/main/lib/chat-engine.ts`）— 会话生命周期管理器。`createAndSend()` 创建新会话并发送首条消息，`send()` 在已有会话上追加。核心方法 `runStream()` 驱动 provider 流并将结果写入 DB。

2. **Provider**（实现 `ChatRuntimeProvider` 接口，定义在 `src/main/agent-runtime/types.ts`）— `streamTurn(input: StreamTurnInput)` 是关键方法，当前 `StreamTurnInput.message` 是一个纯 `string`，只包含当前轮用户文本。

3. **DB**（`messages` 表）— 每条消息有 `role`(user/assistant)、`status`(streaming/complete/aborted/failed)、`content`(JSON-serialized UIMessage)。

当前问题：OpenAI-compatible provider 在 `streamTurn()` 中构建 `messages: [{role:'user', content: message}]`，**没有历史，没有 system prompt**。每轮都是无上下文的单条请求。

### 关键文件

- `src/main/agent-runtime/types.ts` — `StreamTurnInput` 接口（L56-L66），`ChatRuntimeProvider` 接口（L99-L107）
- `src/main/lib/chat-engine.ts` — `runStream()`（L535-L670），`getMessages()`（L367-L405），`prepareTurn()`（L432-L524）
- `src/main/agent-runtime/providers/openai-compatible-provider.ts` — `streamTurn()`（L107-L247），构建 `messages` 数组的位置在 L148-L155
- `src/main/agent-runtime/providers/acp-chat-provider.ts` — `streamTurn()`（L188-L200），仅传 `message` 字符串
- `src/main/db/schema.ts` — `messages` 表（L55-L67），`sessions` 表（L28-L53），`agents` 表（L351-L384）

### Draft 对象

`runStream(draft, userText)` 中的 `draft` 包含：
- `draft.chatSessionId` — 可查 DB 获取 session 行（含 `agentId` FK → agents 表）
- `draft.agentId` — 这是 `agentProfiles.id`（Provider 配置），不是 `agents.id`（Agent identity）
- `draft.runtimeSession` — 包含 `providerKind`

### Agent Identity 的 configJson

`agents.configJson` 字段是 text 类型，schema 注释标注 `"future: system prompt, tools, memory, etc."`。当前存储 `'{}'`。本计划将使用它存储：

    { "systemPrompt": "You are a helpful assistant." }

### Skills 规范（agentskills.io）

Skills 按 progressive disclosure 三层加载：
1. Catalog（name + description）— 注入 system prompt
2. Instructions（SKILL.md body）— LLM 主动 file-read 加载
3. Resources（scripts/references）— 按需加载

SKILL.md 文件结构：YAML frontmatter（`name`、`description`）+ markdown body。


## Plan of Work

### Milestone 1: History + System Prompt 注入

完成后，OpenAI-compatible provider 的每次 turn 会收到完整消息历史和可选的 system prompt。多轮对话实际生效。

在 `src/main/agent-runtime/types.ts` 的 `StreamTurnInput` 接口中添加两个可选字段：

    systemPrompt?: string
    history?: Array<{ role: 'user' | 'assistant', content: string }>

在 `src/main/lib/chat-engine.ts` 的 `runStream()` 方法中，在调用 `provider.streamTurn()` 之前：

1. 通过 `draft.chatSessionId` 查 `sessions` 表获取 `agentId`（Agent identity FK）
2. 如果 `agentId` 存在，查 `agents` 表获取 `configJson`，解析出 `systemPrompt`
3. 查 `messages` 表获取该 session 的所有 `status = 'complete'` 消息，按 `createdAt` 排序，排除当前 turn 的两条（刚插入的 user + assistant）
4. 将 history 和 systemPrompt 传入 `StreamTurnInput`

在 `src/main/agent-runtime/providers/openai-compatible-provider.ts` 的 `streamTurn()` 中，使用新字段构建完整 messages 数组：

    const messages = []
    if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
    for (const msg of input.history ?? []) messages.push(msg)
    messages.push({ role: 'user', content: input.message })

ACP provider 不变。

### Milestone 2: Skills Catalog 扫描和注入

完成后，如果 workspace 或用户目录有 `.agents/skills/`，skill catalog 会自动追加到 system prompt。

新建 `src/main/lib/skills.ts`，导出函数：

    scanSkills(workspacePath?: string): SkillCatalogEntry[]

扫描逻辑：
1. 如果 `workspacePath` 存在，扫描 `{workspacePath}/.agents/skills/*/SKILL.md`
2. 扫描 `~/.agents/skills/*/SKILL.md`
3. 解析每个 SKILL.md 的 YAML frontmatter 提取 `name` 和 `description`
4. Project-level 优先：同名 skill 只保留 project-level 版本
5. 返回 `{ name, description, location }` 数组

在 `ChatEngine.runStream()` 中，调用 `scanSkills(workspacePath)` 获取 catalog，拼接到 systemPrompt 尾部：

    Available skills (read the SKILL.md file at the listed path when the task matches):
    - skill-name: description [/absolute/path/to/SKILL.md]

workspace path 通过 `sessions.workspaceId` → `workspaces.path` 获取。

### Milestone 3: Agent 管理 UI 支持 System Prompt 编辑

完成后，用户可以在 Agent 管理界面编辑 system prompt。

在 `src/renderer/src/features/agent-management/` 的 Agent 编辑表单中添加 system prompt textarea。保存时写入 Agent 的 `configJson.systemPrompt`。

需要修改：
- Agent 编辑组件（添加 textarea）
- AgentService（确保 update 方法正确处理 configJson）

### Milestone 4: 验收

- 创建一个 Agent，设置 system prompt 为 "Always respond in JSON format"
- 通过 OpenAI-compatible provider 发送多条消息
- 验证：LLM 始终以 JSON 格式回复（system prompt 生效）
- 验证：LLM 记住之前的对话内容（history 生效）
- 在 workspace 中放置一个 skill，验证 LLM 能感知到 skill catalog


## Concrete Steps

### Milestone 1

1. 编辑 `src/main/agent-runtime/types.ts`：在 `StreamTurnInput` 接口中添加 `systemPrompt?: string` 和 `history?: Array<{ role: 'user' | 'assistant', content: string }>`

2. 编辑 `src/main/lib/chat-engine.ts` 的 `runStream()` 方法（约 L565-L580）：在 `provider.streamTurn()` 调用前插入 context 组装逻辑

3. 编辑 `src/main/agent-runtime/providers/openai-compatible-provider.ts` 的 `streamTurn()`（约 L148）：用 `input.systemPrompt` + `input.history` + `input.message` 构建完整 messages 数组

### Milestone 2

1. 新建 `src/main/lib/skills.ts`：实现 `scanSkills()` 函数
2. 编辑 `src/main/lib/chat-engine.ts`：在 runStream 中调用 scanSkills 并拼接到 systemPrompt

### Milestone 3

1. 编辑 Agent 编辑组件：添加 system prompt textarea
2. 确保 AgentService.update() 处理 configJson


## Validation and Acceptance

启动 Cradle，创建一个 Agent（OpenAI-compatible provider），在 configJson 中设置 `{"systemPrompt": "You always respond as a pirate."}`。开始新对话，发送 "What's your name?"，LLM 应以海盗语气回复。发送第二条 "What did I just ask you?"，LLM 应引用第一个问题（证明 history 生效）。在 workspace 放置 `.agents/skills/test-skill/SKILL.md`，新对话时 LLM 应在回复中提及可用的 skill（如果被问及）。


## Idempotence and Recovery

所有改动都是代码修改，不涉及 DB migration（configJson 字段已存在）。可以安全重复应用。如果 systemPrompt 或 history 为空/undefined，行为回退到当前状态（单条 user message）。


## Artifacts and Notes

StreamTurnInput 扩展后的完整接口：

    export interface StreamTurnInput {
      runtimeSession: RuntimeSession
      profile: AgentProfile
      message: string
      modelId?: string
      thinkingEffort?: 'low' | 'medium' | 'high'
      systemPrompt?: string
      history?: Array<{ role: 'user' | 'assistant', content: string }>
    }

Skills catalog 注入格式：

    Available skills (read the SKILL.md file at the listed path when the task matches):
    - cradle-cli: Interact with Cradle Kanban boards, issues, and workspaces via CLI. [/path/to/.agents/skills/cradle-cli/SKILL.md]

OpenAI messages 数组构建：

    const messages: ChatCompletionMessageParam[] = []
    if (input.systemPrompt) {
      messages.push({ role: 'system', content: input.systemPrompt })
    }
    for (const msg of input.history ?? []) {
      messages.push({ role: msg.role, content: msg.content })
    }
    messages.push({ role: 'user', content: input.message })


## Interfaces and Dependencies

`src/main/agent-runtime/types.ts` — `StreamTurnInput` 接口扩展 `systemPrompt` 和 `history` 字段

`src/main/lib/skills.ts`（新文件）— 导出：

    interface SkillCatalogEntry {
      name: string
      description: string
      location: string  // absolute path to SKILL.md
    }
    function scanSkills(workspacePath?: string): SkillCatalogEntry[]

依赖：`node:fs`、`node:path`、`node:os`、`js-yaml`（解析 SKILL.md frontmatter，或手写简单解析器避免新依赖）

`src/main/lib/chat-engine.ts` — `runStream()` 方法扩展，导入 `scanSkills` 和 DB 查询

`src/main/agent-runtime/providers/openai-compatible-provider.ts` — `streamTurn()` 使用扩展字段
