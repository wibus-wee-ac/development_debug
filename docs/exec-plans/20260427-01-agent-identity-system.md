# Agent Identity System — Provider/Agent 分离 + Agent 创建交互重构

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. Maintained in accordance with docs/exec-plans/README.md and the PLANS.md convention.


## Purpose / Big Picture

当前 Cradle 的 `AgentProfile` 实体将两个完全不同的概念混为一体：**Provider 连接配置**（base URL、API key、executable path）和 **Agent 身份**（名字、头像、行为偏好、model 选择）。用户在 Settings > Agents > Configured 中添加的其实是 Provider 配置，但 UI 上称之为 "Agent"，导致认知混乱。

重构完成后，用户将能够：

1. 在 Settings 中管理 **Providers**（纯连接配置：OpenAI-compatible / ACP / CLI），与现有流程类似
2. 创建 **Agents**——具有独立身份的 AI 助手，包括：
   - 使用 DiceBear 生成的随机头像（可换风格/种子）
   - 名称和描述
   - 绑定某个 Provider
   - Model 选择器（从 Provider 动态拉取可用模型列表）
   - Thinking Effort 设置（low / medium / high / auto）
   - 可扩展的配置区域（未来支持 system prompt、tools、memory 等）
3. 在新建 Chat 时选择 Agent（而非 Provider），Agent 的身份信息会显示在 Chat header 中
4. 在 Kanban Issue 中委派 Agent 时看到 Agent 头像和名字


## Progress

- [x] Milestone 0: 研究 DiceBear API + 设计数据模型
- [x] Milestone 1: 数据库迁移 — 新增 agents 表，保留 agent_profiles 为 providers
- [x] Milestone 2: 后端 Service — AgentService CRUD + IPC 绑定
- [x] Milestone 3: 前端 Provider 管理 — 重命名 UI，调整现有设置页
- [x] Milestone 4: 前端 Agent 创建/编辑 — 新 UI 组件
- [x] Milestone 5: 集成 — 新建 Chat 使用 Agent 选择器（Kanban 待后续）
- [x] Milestone 6: 验收 + 回归测试


## Surprises & Discoveries

- `agents-settings.tsx` 的 data-testid 是 `agents-settings` 而非 `agent-runtime-settings`，E2E 步骤需对应更新
- 现有 E2E 步骤 `我点击"Agents"导航项` 指向 `settings-nav-agents`，但 Provider 管理页已迁移到 `settings-nav-providers`，需修正
- 2 个 pre-existing 单元测试失败（`workspace-sidebar.test.tsx` 中 `TopNavItem` 导入问题），与本次变更无关


## Decision Log

- Decision: Provider 和 Agent 分为两张表，而非在 agent_profiles 上加字段区分
  Rationale: Provider 是"连接"，Agent 是"身份"。它们的生命周期不同（一个 Provider 可被多个 Agent 共用），字段完全不重叠。分表更清晰。
  Date: 2026-04-27

- Decision: DiceBear 头像使用 URL 存储，不下载图片到本地
  Rationale: DiceBear 的 CDN URL 是确定性的（基于 style + seed），无需本地缓存。格式：`https://api.dicebear.com/9.x/{style}/svg?seed={seed}`。离线场景下降级为字母缩写 Avatar。
  Date: 2026-04-27

- Decision: Agent 创建交互使用 "Island-like" 展开式表单，而非 Dialog
  Rationale: DESIGN.md 的空间恒常性原则——同一位置变形出创建面板，而非弹出遮罩层。参考 craft-agents-oss 的 Island 组件哲学：减少认知中断。创建 Agent 应该感觉像是在"就地展开"一个新卡片。
  Date: 2026-04-27

- Decision: Thinking Effort 使用 slider 三档（low / medium / high）+ auto 开关
  Rationale: 参考 Claude API 的 thinking budget 设计。大多数用户不需要精确控制，三档 + auto 覆盖 99% 场景。
  Date: 2026-04-27


## Outcomes & Retrospective

- 所有 6 个 Milestone 已完成
- Provider/Agent 分离已落地：Settings 侧栏分为 Providers 和 Agents 两个独立页面
- Agent Identity 系统支持 DiceBear 头像、Provider/Model 绑定、Thinking Effort 配置
- 新建 Chat 页面已集成 Agent 选择器，显示头像和名字
- E2E 测试新增 `agent-identity.feature`（4 个场景），更新 `agent-runtime-settings.feature` 导航步骤
- Kanban Issue 委派仍使用 Provider 层（`useAgentProfiles`），待后续迭代迁移到 Agent Identity


## Context and Orientation

### 当前代码结构

**数据库**：`src/main/db/schema.ts` 中的 `agent_profiles` 表存储了 Provider 配置（`providerKind`, `configJson`, `credentialRef`）和 Agent 身份信息（`name`, `enabled`）的混合体。没有独立的 Provider 表。

**后端服务**：`src/main/services/agent-runtime.ts` 中的 `AgentRuntimeService` 提供 CRUD IPC（`listProfiles`, `upsertProfile`, `removeProfile`, `probeProfile`, `listModels`, `saveCredential`）。

**Provider 实现**：`src/main/agent-runtime/providers/` 下有 4 个 provider：
- `openai-compatible-provider.ts` — HTTP REST，支持 `streamTurn`
- `acp-chat-provider.ts` — 本地 ACP 进程
- `cli-tui-provider.ts` — 终端 PTY
- `codex-app-server-provider.ts` — Codex JSONL stdio（已有代码但未在 ProviderKind enum 中注册）

**前端**：
- `src/renderer/src/features/agent-runtime/` — 数据 hooks（useAgentProfiles, useAgentModels 等）
- `src/renderer/src/features/agent-management/agents-settings.tsx` — 设置页 UI（约 750 行，包含 ACP Registry + Profile CRUD）
- Settings 通过 `settings-content.tsx` 的 `section='agents'` 加载

**类型定义**：`src/main/ipc-types.ts` 和 `src/main/agent-runtime/types.ts` 定义了 `AgentProfile`, `ProviderKind`, `AgentProvider` 等接口。

### DiceBear API

DiceBear 是一个确定性头像生成服务。URL 格式：

    https://api.dicebear.com/9.x/{style}/svg?seed={seed}

可用风格包括：`bottts`, `bottts-neutral`, `thumbs`, `shapes`, `identicon`, `initials`, `pixel-art`, `adventurer`, `fun-emoji` 等。相同 style + seed 总是生成相同图片。

在 Cradle 中的使用方式：Agent 创建时随机生成一个 seed（UUID 或名字 hash），用户可以点击"换一个"来重新生成 seed。头像 URL 存储在数据库中，渲染时直接作为 `<img src>` 使用。


## Plan of Work

### Milestone 0: 设计数据模型和 DiceBear 集成方案

研究 DiceBear 可用风格，确定默认风格。设计 `agents` 表 schema。确定 Agent 与 Provider 的关系模型。

### Milestone 1: 数据库迁移

在 `src/main/db/schema.ts` 中新增 `agents` 表：

    agents 表：
      id          text    PK（UUID）
      name        text    NOT NULL
      description text    nullable
      avatarUrl   text    nullable       — DiceBear URL
      avatarStyle text    NOT NULL default 'bottts-neutral'
      avatarSeed  text    NOT NULL        — 用于重新生成
      providerId  text    NOT NULL        — FK → agent_profiles.id
      modelId     text    nullable        — 选中的模型标识符
      thinkingEffort text NOT NULL default 'auto' — 'low' | 'medium' | 'high' | 'auto'
      configJson  text    NOT NULL default '{}' — 可扩展配置（future: system prompt, tools 等）
      enabled     int     NOT NULL default 1
      createdAt   int     NOT NULL default unixepoch
      updatedAt   int     NOT NULL default unixepoch

同时将现有 UI 中所有 "Agent" 术语替换为 "Provider"（仅 agent_profiles 相关的）。

创建 drizzle migration 文件：`drizzle/0013_add_agents_table.sql`。

### Milestone 2: 后端 Service

在 `src/main/services/` 新增 `agent.ts`，提供：

    AgentService:
      listAgents()                    → Agent[]
      getAgent(id)                    → Agent | null
      createAgent(input)              → Agent
      updateAgent(id, patch)          → Agent
      deleteAgent(id)                 → void
      listModelsForAgent(agentId)     → string[]（委托给 AgentRuntimeService.listModels）

在 `src/main/ipc-types.ts` 中新增：

    interface Agent {
      id: string
      name: string
      description: string | null
      avatarUrl: string | null
      avatarStyle: string
      avatarSeed: string
      providerId: string
      modelId: string | null
      thinkingEffort: 'low' | 'medium' | 'high' | 'auto'
      configJson: string
      enabled: boolean
      createdAt: number
      updatedAt: number
    }

在 IPC handler 注册 `agent.*` namespace。

### Milestone 3: 前端 Provider 管理

将 `features/agent-management/agents-settings.tsx` 中的 "Agents" 标签和 "Configured" tab 重命名为 "Providers"。Settings sidebar 的 "Agents" 项拆分为两项：
- "Providers" — 现有的 Provider 配置 + ACP Registry
- "Agents" — 新建的 Agent 管理页

确保现有功能不受影响，只做术语调整和路由分离。

### Milestone 4: 前端 Agent 创建/编辑 UI

**这是交互设计的核心。**

新建 `src/renderer/src/features/agent-management/agent-editor.tsx`，实现就地展开式的 Agent 编辑器。

**创建流程交互设计**：

1. Agent 列表页顶部有一个"+ New Agent"按钮
2. 点击后，列表顶部就地展开一个创建表单卡片（motion spring 动画），不弹 Dialog
3. 表单分为两个区域：
   - **左侧**：头像区（DiceBear 预览 + 风格选择器 + "shuffle" 按钮换 seed）
   - **右侧**：字段区
     - Name（text input）
     - Description（optional textarea，单行高度，focus 展开）
     - Provider（Select，从已有 providers 中选）
     - Model（Select，provider 选中后动态加载模型列表）
     - Thinking Effort（三档 segmented control + auto toggle）
4. 底部：Cancel + Create 按钮（bg-foreground text-background 风格）
5. 创建成功后，卡片收缩回列表项，新 Agent 出现在列表中

**Agent 列表项设计**：

每个 Agent 显示为一行：头像（32px）+ 名字 + 描述（truncate）+ Provider badge + Model badge + enabled toggle。hover 显示编辑/删除操作。点击展开为编辑表单（同创建表单，但预填数据）。

**头像风格选择器**：

使用横向滚动的 pill 列表展示 6 个预设风格：`bottts-neutral`, `thumbs`, `shapes`, `identicon`, `pixel-art`, `adventurer`。选中风格高亮，DiceBear 预览实时更新。

**Thinking Effort 控件**：

三段式 segmented control（Low / Medium / High），旁边一个 "Auto" toggle。Auto 开启时三段控件变为 disabled 态。

### Milestone 5: 集成

1. `/new-chat` 页的 profile picker 改为 agent picker（显示头像 + 名字），保留 model override 功能
2. Chat header 显示当前 Agent 的头像和名字
3. Kanban issue delegation 的 agent 选择器使用新的 Agent 列表

### Milestone 6: 验收 + E2E 测试

更新 `e2e/src/features/agent-runtime-settings.feature` 以覆盖新的 Provider/Agent 分离。新增 Agent 创建/编辑的基本 E2E 场景。


## Concrete Steps

（每个 Milestone 在实施时展开为具体命令和文件编辑）


## Validation and Acceptance

1. Settings > Providers 页面展示现有 provider 配置，功能与之前完全一致
2. Settings > Agents 页面可以创建新 Agent：
   - 选择 DiceBear 风格，点击 shuffle 换头像
   - 选择 Provider 后，Model 下拉自动加载可用模型
   - 设置 Thinking Effort
   - 创建后 Agent 出现在列表中
3. Settings > Agents 页面可以编辑和删除 Agent
4. `/new-chat` 页面显示 Agent 列表（带头像），创建会话时使用选中 Agent 的 provider + model
5. Kanban Issue 委派时显示 Agent 头像

验收命令：

    pnpm dev
    # 打开 Settings > Providers — 确认现有 provider 正常
    # 打开 Settings > Agents — 创建一个新 Agent，绑定到现有 provider
    # 新建 Chat — 选择刚创建的 Agent，发送消息确认正常

    pnpm test
    # 所有现有测试通过

    pnpm --filter e2e test
    # E2E 测试通过


## Idempotence and Recovery

- 数据库迁移是 additive（仅新增表），不修改现有表结构，可安全重复执行
- 如果迁移失败，删除 `drizzle/0013_add_agents_table.sql` 和 meta 文件即可回退
- 前端术语重命名（Agent → Provider）是纯展示层变更，不影响数据


## Artifacts and Notes

### DiceBear URL 格式

    https://api.dicebear.com/9.x/bottts-neutral/svg?seed=my-agent-name
    https://api.dicebear.com/9.x/thumbs/svg?seed=abc123&backgroundColor=transparent

### 推荐的 DiceBear 风格

- `bottts-neutral` — 几何机器人，干净中性（推荐默认）
- `thumbs` — 卡通手指/人物
- `shapes` — 纯几何形状
- `identicon` — GitHub 风格散列图案
- `pixel-art` — 像素风
- `adventurer` — 探索者角色


## Interfaces and Dependencies

### 新增表 schema（src/main/db/schema.ts）

    export const agents = sqliteTable('agents', {
      id: text('id').primaryKey(),
      name: text('name').notNull(),
      description: text('description'),
      avatarUrl: text('avatar_url'),
      avatarStyle: text('avatar_style').notNull().default('bottts-neutral'),
      avatarSeed: text('avatar_seed').notNull(),
      providerId: text('provider_id').notNull().references(() => agentProfiles.id),
      modelId: text('model_id'),
      thinkingEffort: text('thinking_effort').notNull().default('auto'),
      configJson: text('config_json').notNull().default('{}'),
      enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
      createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
      updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
    })

### 新增 IPC 接口（src/main/ipc-types.ts）

    interface AgentIpc {
      list(): Promise<Agent[]>
      get(id: string): Promise<Agent | null>
      create(input: CreateAgentInput): Promise<Agent>
      update(id: string, patch: Partial<AgentUpdateFields>): Promise<Agent>
      delete(id: string): Promise<void>
      listModels(agentId: string): Promise<string[]>
    }

### 前端新增组件

    src/renderer/src/features/agent-management/
      agent-list.tsx          — Agent 列表页（Settings section）
      agent-editor.tsx        — 就地展开式创建/编辑表单
      agent-avatar-picker.tsx — DiceBear 风格选择器 + shuffle
      use-agents.ts           — TanStack Query hooks for agent CRUD
