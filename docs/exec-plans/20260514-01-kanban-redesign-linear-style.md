# Kanban Redesign SPEC — Linear-Style Issue Board

> 完全推翻现有前端实现，以 Linear 为设计标杆。直接复刻 Linear 的 UI/UX。
> 后端 API 已具备绝大部分能力，前端需从零重做。
> **实施原则：看 Linear 的 UI 来做，不看我们现有的 web UI。**

---

## 1. 视图架构

### 1.1 视图模式

| 视图 | 切换方式 | 说明 |
|------|----------|------|
| **Board** | Layout toggle / `Cmd` | 看板列视图（默认） |
| **List** | Layout toggle / `Cmd` | 紧凑列表视图（Linear 的列表即表格） |
| **Detail** | 点击 issue / `Enter` | 全页 issue 详情（Linear 是全页，非 modal） |

Board 和 List 共享同一 Tab instance，通过内部 layout toggle 切换（Linear 用 `Cmd` 一键切换）。Issue Detail 是独立全页路由。

### 1.2 导航结构（复刻 Linear sidebar）

```
Sidebar:
├── Inbox                        → 通知/mentions
├── My Issues                    → assigneeId = currentUser 的 issues
├── ────────────────
├── [Team] Issues                → Board/List 视图（按 workspace 分）
│   ├── All Issues
│   ├── Active                   → status in started category
│   └── Backlog                  → status in backlog category
├── [Team] Milestones            → 里程碑/项目列表
├── [Team] Agent Sessions        → 所有 agent 活动总览
└── ────────────────
    Views                        → 用户自定义 saved views（filter presets）
```

---

## 2. Board View（看板列视图）

### 2.1 列分组

默认按 **Status** 分组（Linear 默认行为）。

- 列顺序 = `kanban_statuses.order`
- 列头：status name + issue count（可切换为 estimate sum）
- 空列默认显示，可通过 Display Options 隐藏
- 无 status 的 issue 归入首列

**可选分组维度**（Display Options → Group By）：
- Status（默认）
- Priority
- Milestone
- Assignee
- Label

**Sub-grouping（swimlanes）**：Board 支持第二维度分组作为水平行（如列按 Status，行按 Assignee）。

### 2.2 卡片设计（复刻 Linear card）

紧凑、高密度。所有 display properties 可配置：

```
┌──────────────────────────────────────────┐
│ [○ status-icon]  Issue title text        │
│                                          │
│ ENG-42  [Bug] [Frontend]   [@avatar]     │
│         [🤖 agent-status]  [2/5 subs]   │
└──────────────────────────────────────────┘
```

**可配置 Display Properties**（per view，Linear 支持全部开关）：
- Issue ID（如 `ENG-42`，格式 = workspace prefix + 序号）
- Status icon（圆形，颜色按 status category）
- Priority icon（bar 图标，颜色编码）
- Labels（colored chips）
- Assignee avatar
- Sub-issue progress（`2/5`）
- Agent indicator（robot icon + session status dot）
- Milestone/Project
- Created/Updated date
- Due date
- Relations count

### 2.3 拖拽行为（复刻 Linear DnD 语义）

- **跨列拖拽** → 自动采用目标分组属性（如拖到 "Done" 列 → status = Done）
- **列内拖拽** → 手动排序（全局保存，所有用户可见）
- **键盘移动**：`Option+Shift+↑/↓` 移动到列顶部/底部
- Optimistic update + 失败回滚
- 使用 `@dnd-kit/core`

### 2.4 Toolbar

```
[Search] [Filter ▾] [Group By ▾] [Sub-group ▾] [Sort ▾] [Display ▾] [Layout □/≡]
```

**Filter Panel**（multi-level facet filter，可叠加）：
- Status（multi-select with category grouping）
- Priority（multi-select）
- Labels（multi-select）
- Milestone（single-select）
- Assignee（multi-select with agent/user/unassigned sections）
- Delegated（boolean：has agent / no agent）
- Has sub-issues（boolean）
- Created date range
- Updated date range

**Sort Options**：
- Manual（default for board）
- Priority
- Created（newest/oldest）
- Updated（newest/oldest）
- Status order

**Search**（inline search bar with instant results）：
- `GET /kanban/issues/search?q=...`
- Debounce 200ms
- Results overlay current view as filtered list

---

## 3. List View（紧凑列表）

复刻 Linear 的 list view — 本质是表格但不像传统 data table。

### 3.1 行设计

单行 = 一个 issue（行高 32-36px）：

```
[X] [○] [!] ENG-42  Issue title text  [Bug] [Frontend]  [In Progress]  [@user]  2d ago
```

从左到右：
- Checkbox（multi-select）
- Status icon
- Priority icon
- Issue ID
- Title（truncated）
- Labels
- Status badge（文字）
- Assignee avatar
- Relative date

### 3.2 Group Headers

List 可按 status/priority/milestone/assignee 分组，显示为 section headers：
```
▼ In Progress  (3)
  [row]
  [row]
  [row]
▼ Todo  (7)
  [row]
  ...
```

### 3.3 Multi-select & Bulk Actions

- `X` toggle 选中单个
- `Shift+Click` 范围选择
- `Cmd+A` 全选当前 group
- 选中后顶部浮出 bulk action bar：

```
[3 selected]  [Status ▾] [Priority ▾] [Assign ▾] [Label ▾] [Delete]  [×]
```

---

## 4. Issue Detail View（全页详情）

### 4.1 布局（复刻 Linear issue detail page）

全页路由。Linear 式布局：

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to list   ENG-42                          [⋮ Menu]  │
├─────────────────────────────────────────┬───────────────────┤
│                                         │                   │
│  [Issue Title — large, editable]        │  Status    [●→]   │
│                                         │  Priority  [!!]   │
│  ─────────────────────────────────────  │  Assignee  [@]    │
│                                         │  Labels    [+]    │
│  [Description — rich Markdown editor]   │  Milestone [sel]  │
│                                         │  Due date  [📅]   │
│                                         │  ───────────────  │
│  ─────────────────────────────────────  │  Relations        │
│                                         │  ⊘ Blocks #43     │
│  Sub-Issues                             │  ⊘ Blocked by #41 │
│  ┌ #43 Implement parser  [●→ IP]       │  ───────────────  │
│  ├ #44 Write tests       [○ Todo]      │  Context Refs     │
│  └ + Add sub-issue                      │  📄 src/lib/x.ts  │
│                                         │  🔗 PR #123       │
│  ─────────────────────────────────────  │  ───────────────  │
│                                         │  Agent            │
│  Agent Session                          │  🤖 Claude Agent  │
│  ┌─────────────────────────────────┐   │  Status: Active   │
│  │ [Plan] ✓ Parse input            │   │  [Stop] [View]    │
│  │        → Implement transform    │   │                   │
│  │        ○ Write tests            │   │                   │
│  │ [Activity]                      │   │                   │
│  │  💭 Analyzing the codebase...   │   │                   │
│  │  🔧 Modified src/parser.ts      │   │                   │
│  │  💬 Implementation complete     │   │                   │
│  └─────────────────────────────────┘   │                   │
│                                         │                   │
│  ─────────────────────────────────────  │                   │
│                                         │                   │
│  Activity & Comments                    │                   │
│  ┌─────────────────────────────────┐   │                   │
│  │ 🧑 user: Can we also handle..  │   │                   │
│  │ 🤖 agent: I'll add that case.. │   │                   │
│  │ ⊙ Status changed to In Progress│   │                   │
│  └─────────────────────────────────┘   │                   │
│  [                Comment input       ] │                   │
│                                         │                   │
└─────────────────────────────────────────┴───────────────────┘
```

### 4.2 Properties Sidebar（右侧 280px）

所有属性 inline 编辑，点击即弹出 selector。复刻 Linear 右侧面板：

- **Status**：dropdown with category-grouped statuses（icon + name）
- **Priority**：icon selector（Urgent/High/Medium/Low/None，每级有颜色）
- **Assignee**：avatar dropdown（包含 agent profiles）
- **Labels**：multi-select chips + inline 创建
- **Milestone**：dropdown
- **Due date**：date picker
- **Relations**：
  - Blocks / Blocked by / Related / Duplicate
  - 点击 "+" 添加 → issue search picker
  - Blocking issues 显示 orange/red 标志
- **Context Refs**：file paths / URLs（linked resources）
- **Agent Delegation**（详见 §6）

### 4.3 Sub-Issues

位于 description 下方：
- 列表展示 `parentIssueId = current` 的所有 issues
- 每行：status icon + title + assignee avatar
- "+" 行内创建（标题 + Enter = instant create）
- 可展开/折叠已完成的 sub-issues
- 可拖拽排序

### 4.4 Activity & Comments Timeline

位于页面底部。混合时间线（Linear 模式）：

**条目类型**：
- **User comment**（`author_kind: 'user'`）：头像 + Markdown + 相对时间
- **Agent comment**（`author_kind: 'agent'`）：robot avatar + Markdown
- **System event**（`author_kind: 'system.*'`）：灰色 inline 事件行
  - "Status changed from Todo to In Progress"
  - "Agent delegated to Claude Agent"
  - "Milestone set to v1.0"
  - "Label added: Bug"

**新评论**：bottom-pinned textarea，`Cmd+Enter` 提交。

### 4.5 Peek Preview（`Space` 快捷键）

在 Board/List 视图中按 `Space` → 弹出 issue summary overlay（不离开当前上下文）：
- 标题 + status + priority
- Description 前 3 行
- 最近 activity
- 点击 overlay 外部或 `Esc` 关闭

---

## 5. Agent Session Interaction（复刻 Linear Agent Session UI）

### 5.1 核心概念映射

| Linear | Cradle | 说明 |
|--------|--------|------|
| Agent Session | `agent_sessions` row | 追踪 agent 工作生命周期 |
| Agent Activity | `agent_activities` row | agent 产生的活动条目 |
| Agent Plan | 新增 `plan` JSON 字段 | session 级别的任务 checklist |
| Session States | `status` enum | pending/active/completed/stopped/failed |
| Signals | `signal` field | stop/auth/select 等元信号 |

### 5.2 Session States（复刻 Linear 6 态）

```typescript
type AgentSessionStatus =
  | 'pending'    // 刚创建，等待 agent 响应
  | 'active'     // agent 正在工作
  | 'completed'  // agent 完成
  | 'stopped'    // 用户手动停止
  | 'failed'     // agent 遇到错误
  | 'stale'      // agent 超时未响应（新增）
```

**自动状态推断**（复刻 Linear 行为）：
- Session 创建 → `pending`
- 收到第一个 activity → `active`
- 30 分钟无新 activity → `stale`（可恢复）
- 收到 `response` type activity → `completed`
- 收到 `error` type activity → `failed`
- 用户点 Stop → `stopped`

### 5.3 Agent Activities（复刻 Linear 5 种类型）

```typescript
type AgentActivityType =
  | 'thought'      // 💭 内部思考（可标记 ephemeral）
  | 'action'       // 🔧 执行的操作（修改文件、运行命令等）
  | 'response'     // 💬 最终回复（标志 session 完成）
  | 'elicitation'  // ❓ 向用户请求输入（可带 select signal）
  | 'error'        // ❌ 错误信息
  | 'prompt'       // 🧑 用户对 agent 的追加指令
```

**UI 渲染**：

- `thought`：灰色斜体文字，可折叠。Ephemeral thought 会被下一个 activity 替换。
- `action`：带 icon 的操作行（如 "Modified src/parser.ts"，"Ran tests"）
- `response`：full-width Markdown 渲染，绿色左边框
- `elicitation`：问题文字 + 选项按钮（如果有 `select` signal）
- `error`：红色左边框错误信息
- `prompt`：用户输入，右对齐样式

### 5.4 Agent Plans（复刻 Linear Agent Plan）

Session 级别的 checklist，显示 agent 的工作计划：

```typescript
interface AgentPlanStep {
  content: string
  status: 'pending' | 'inProgress' | 'completed' | 'canceled'
}
```

**UI**：在 Issue Detail 的 Agent Session 区域顶部显示：
```
Agent Plan
  ✓ Parse input format
  → Implement data transformation (in progress)
  ○ Write unit tests
  ○ Update documentation
```

**后端变更**：`agent_sessions` 表新增 `plan` TEXT 字段（JSON array）。

### 5.5 Signals（复刻 Linear signals）

**Human-to-Agent**：
- `stop`：用户请求 agent 停止。Agent 必须立即停止所有操作，发出一个最终 `response` 或 `error` activity 确认已停止。

**Agent-to-Human**：
- `select`：agent 提供选项让用户选择（如 "哪个 repo？"）
  - `signalMetadata: { options: [{ label, value }] }`
  - UI 渲染为按钮组，用户点击后自动创建 `prompt` activity
- `auth`：agent 需要用户完成认证（暂不实现）

### 5.6 User Prompt to Agent（追加指令内部逻辑）

当用户在 Issue Detail 的 Agent Session 面板底部输入追加指令时：

**前端**：
1. 用户在 agent-prompt-input 输入文字，按 Enter / Cmd+Enter
2. 调用 `POST /issue-agent-sessions/:agentSessionId/prompt { text: "..." }`
3. Optimistic：立即在 activity feed 底部显示 `prompt` 条目

**后端处理流程**：
```
POST /issue-agent-sessions/:agentSessionId/prompt
│
├─ 1. 验证 session 存在且 status ∈ { completed, stopped, failed, stale }
│     （如果 session 是 active/pending，拒绝 409 — agent 正在工作）
│
├─ 2. 创建 agent_activity { type: 'prompt', body: userText }
│     — 记录用户的追加指令
│
├─ 3. 更新 agent_session.status = 'active'
│     — session 重新激活
│
├─ 4. 获取 session.chatSessionId
│     — 每个 agent session 都绑定一个 chat session
│
├─ 5. 调用 ChatRuntime.createRun({ sessionId: chatSessionId, text: userText })
│     — 在已有的 chat session 上创建新 run
│     — Chat history 自动累积（之前的对话都在这个 session 里）
│     — Agent 看到完整上下文 + 新指令
│
├─ 6. 启动 watchRunCompletion(agentSessionId, runId)
│     — 后台 polling，等待 run 完成
│     — 完成时自动创建 'response' activity
│     — 失败时自动创建 'error' activity
│
└─ 返回 200 { activity: AgentActivity }
```

**核心设计**：
- Agent 的工作记忆 = chat session history。用户的 prompt 被注入到同一个 chat session，agent 自然拥有完整上下文。
- 一个 agent_session 对应一个 chat_session，多轮 prompt 都在同一个 chat session 里累积。
- 如果 session 是 `active`（agent 正在工作），prompt 被拒绝（409）。用户需要先 stop，再 prompt。
  - 未来可增强：允许 queue pending prompts，agent 完成当前 run 后自动处理。

**Edge Cases**：
- Session status = `stale`：允许 prompt（重新激活 agent）
- Chat session 被删除：返回 500，提示 session 已失效
- createRun 返回 409（chat session busy）：回退 prompt activity，返回 409

### 5.7 Delegation UI（Issue Detail 中）

**未委派时**：
- Properties sidebar 显示 "Agent: None" + "Delegate" 按钮
- 点击 → Agent Profile picker dropdown

**委派后**：
- Properties sidebar 显示 agent name + status badge
- "Stop" / "Rerun" / "View Chat" 按钮
- Issue Detail 主区域出现 "Agent Session" section（plan + activity feed）

**Agent Activity Feed（in issue detail）**：
- 实时更新（polling 500ms when session is active）
- 混合显示 agent activities 和 user prompts
- 用户可在底部输入追加指令（详见 §5.6）

### 5.8 Agent 在 Board/List 中的可见性

**Board 卡片**：
- 左下角显示 agent avatar（小尺寸 16px）
- Status dot：green（active）/ gray（completed）/ red（failed）/ yellow（pending）

**List 行**：
- Agent 列显示 robot icon + status color dot

**状态自动化**（复刻 Linear best practice）：
- Agent 开始工作 → issue status 自动移到第一个 "started" category status
- Agent 完成 → 不自动移（让用户 review 后手动关闭）

---

## 6. 键盘快捷键（复刻 Linear）

| 快捷键 | 动作 | 上下文 |
|--------|------|--------|
| `C` | 创建 issue（quick create modal） | Global |
| `Cmd+Shift+C` | 创建 issue（full editor） | Global |
| `Cmd` | 切换 Board ↔ List | Board/List |
| `Enter` | 打开 issue 详情 | Board/List（焦点在 issue 上） |
| `Esc` | 返回上一视图 / 关闭弹窗 | Global |
| `Space` | Peek preview | Board/List |
| `S` | 修改 Status | Issue focused |
| `P` | 修改 Priority | Issue focused |
| `L` | 修改 Labels | Issue focused |
| `A` | 修改 Assignee | Issue focused |
| `D` | Delegate to Agent | Issue focused |
| `X` | 选中/取消选中 | Board/List |
| `Shift+Click` | 范围选择 | List |
| `Cmd+K` | 全局命令面板 | Global |
| `Cmd+Shift+O` | 创建 sub-issue | Issue Detail |
| `Option+Shift+↑/↓` | 移动 issue 到列顶/底 | Board |
| `↑/↓` | 焦点移动 | Board/List |
| `←/→` | 跨列焦点移动 | Board |
| `Delete` | 删除 issue（需确认） | Issue focused |
| `Cmd+.` | 切换 properties sidebar | Issue Detail |
| `T` | 折叠/展开 group header | Board/List |

---

## 7. Display Options（视图配置面板）

```typescript
interface KanbanViewConfig {
  layout: 'board' | 'list'
  groupBy: 'status' | 'priority' | 'milestone' | 'assignee' | 'label'
  subGroupBy?: 'status' | 'priority' | 'milestone' | 'assignee' | 'label' | null
  orderBy: 'manual' | 'priority' | 'created' | 'updated' | 'status'
  orderDirection: 'asc' | 'desc'
  showEmptyGroups: boolean
  showSubIssues: boolean
  displayProperties: {
    id: boolean
    priority: boolean
    status: boolean
    labels: boolean
    assignee: boolean
    subIssueProgress: boolean
    agentIndicator: boolean
    milestone: boolean
    dueDate: boolean
    createdAt: boolean
    updatedAt: boolean
    relations: boolean
  }
}

interface KanbanFilterState {
  statusIds?: string[]
  priorities?: ('none' | 'low' | 'medium' | 'high' | 'urgent')[]
  labels?: string[]
  milestoneId?: string | null
  assigneeIds?: string[]
  isDelegated?: boolean | null
  hasSubIssues?: boolean | null
  createdAfter?: number | null
  createdBefore?: number | null
}
```

配置存 localStorage（per workspace per view）。可另存为 "Custom View"（saved filter preset）。

---

## 8. 后端变更需求

### 8.1 Issue Ordering（新增 `order` 字段）

```sql
ALTER TABLE kanban_issues ADD COLUMN "order" REAL NOT NULL DEFAULT 0;
```

- Fractional indexing：新 issue 在列末尾（取当前最大 order + 1024）
- 拖拽排序：计算目标位置前后 issue 的 order 中间值
- 新端点或复用 PATCH：`PATCH /kanban/issues/:id { order: number }`

### 8.2 Bulk Operations（新增）

```
PATCH /kanban/issues/bulk
Body: { issueIds: string[], update: { statusId?, priority?, labels?, milestoneId?, assigneeId?, assigneeKind? } }
Response: { updated: number }
```

### 8.3 Agent Plan（新增字段）

```sql
ALTER TABLE agent_sessions ADD COLUMN "plan" TEXT;  -- JSON: AgentPlanStep[]
```

新端点：
```
PATCH /issue-agent-sessions/:id/plan
Body: { plan: AgentPlanStep[] }
Response: { ok: true }
```

### 8.4 Agent Session Stale Detection

Background job（或 poller enhancement）：标记 30min 无新 activity 的 active session 为 `stale`。
Schema change：`agent_sessions.status` enum 增加 `'stale'`。

### 8.5 User Prompt to Agent（新端点）

```
POST /issue-agent-sessions/:id/prompt
Body: { text: string }
Response: AgentActivity
```

创建一个 `type: 'prompt'` 的 activity，并通知 agent 继续工作。

### 8.6 Server-side SQL Filtering

重构 `listIssues` service：
- 所有 filter 参数转为 SQL WHERE 子句
- `labels` 使用 `json_each(labels) IN (...)` 或 SQLite 的 `LIKE` 模式
- 支持 `orderBy` query param

### 8.7 Issue Count Endpoint（可选优化）

```
GET /kanban/issues/counts?workspaceId=...&groupBy=status
Response: { counts: Record<string, number> }
```

---

## 9. 前端组件结构

```
features/kanban/
├── index.tsx                     # Route entry, owns view config state
├── kanban-board.tsx              # Board layout (columns + DnD context)
├── kanban-list.tsx               # List layout (grouped rows)
├── kanban-toolbar.tsx            # Search + Filter + Group + Sort + Display + Layout toggle
├── kanban-column.tsx             # Single board column (header + cards)
├── kanban-card.tsx               # Board card (compact issue preview)
├── kanban-list-row.tsx           # List row (single-line issue)
├── kanban-group-header.tsx       # Collapsible group header (for list view groups)
├── kanban-bulk-bar.tsx           # Bulk action bar (appears when items selected)
├── kanban-peek.tsx               # Peek preview overlay (Space shortcut)
├── kanban-dnd.tsx                # DnD context wrapper + sortable logic
├── filter-panel.tsx              # Filter popover (multi-facet)
├── display-options.tsx           # Display options popover
├── create-issue-dialog.tsx       # Quick create modal (C shortcut)
├── use-kanban.ts                 # TanStack Query hooks (existing, extend)
├── use-view-config.ts            # View config persistence + state
├── use-keyboard-nav.ts           # Keyboard navigation + shortcuts
│
├── issue-detail/
│   ├── index.tsx                 # Full-page issue detail
│   ├── issue-header.tsx          # Title + back + actions
│   ├── issue-description.tsx     # Markdown editor
│   ├── properties-sidebar.tsx    # Right sidebar (all fields)
│   ├── sub-issues-list.tsx       # Sub-issues section
│   ├── activity-timeline.tsx     # Comments + system events mixed timeline
│   ├── agent-session-panel.tsx   # Agent plan + activity feed
│   ├── agent-activity-item.tsx   # Single agent activity row renderer
│   ├── agent-plan-display.tsx    # Plan checklist UI
│   ├── agent-prompt-input.tsx    # User prompt input to agent
│   ├── relation-manager.tsx      # Relations CRUD
│   └── context-refs.tsx          # File/URL references
│
└── shared/
    ├── status-icon.tsx           # Status circle icon (color by category)
    ├── priority-icon.tsx         # Priority bar icon (color by level)
    ├── label-chip.tsx            # Colored label chip
    ├── assignee-avatar.tsx       # User/agent avatar (with agent badge)
    └── issue-id.tsx              # Formatted issue ID (monospace)
```

---

## 10. Status Categories（复刻 Linear 工作流）

Linear 的 status 有固定的 **category** 顺序。我们需要在 `kanban_statuses` 上增加 `category` 字段：

```typescript
type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
```

**Category 顺序固定**（左 → 右，用户不可调），category 内的 statuses 可自定义排序。

**后端变更**：
```sql
ALTER TABLE kanban_statuses ADD COLUMN "category" TEXT NOT NULL DEFAULT 'unstarted';
```

默认种子 statuses（新 workspace 自动创建）：
- Triage（category: triage）
- Backlog（category: backlog）
- Todo（category: unstarted）
- In Progress（category: started）
- Done（category: completed）
- Canceled（category: canceled）

**Status icons**（按 category 着色）：
- triage: purple circle
- backlog: gray dotted circle
- unstarted: gray empty circle
- started: yellow/amber half-filled circle
- completed: green filled circle
- canceled: gray struck-through circle

---

## 11. 实施优先级

| Phase | 内容 | 依赖 |
|-------|------|------|
| **P0** | Board View + Column + Card + DnD + Status-based grouping | 现有 API + order 字段 |
| **P0** | List View + Row + Group headers + Sort | 现有 API |
| **P0** | Toolbar（Search + Filter + Group + Display + Layout toggle） | 现有 API |
| **P0** | Issue Detail 全页（Title + Description + Properties Sidebar） | 现有 API |
| **P0** | Activity & Comments timeline | 现有 API |
| **P0** | Sub-issues list + inline create | 现有 API |
| **P0** | Status categories + seed statuses | §10 后端变更 |
| **P1** | Agent Session panel in detail（plan + activities） | §8.3 plan 字段 |
| **P1** | Agent delegation flow + status visibility on cards | 现有 API |
| **P1** | User prompt to agent (in issue detail) | §8.5 prompt 端点 |
| **P1** | Keyboard shortcuts 全集 | 前端 only |
| **P1** | Peek preview (`Space`) | 前端 only |
| **P1** | Multi-select + Bulk actions | §8.2 bulk 端点 |
| **P2** | Custom Views (saved filter presets) | 前端 only (localStorage) |
| **P2** | Swimlane sub-grouping | 前端 only |
| **P2** | Server-side SQL filtering | §8.6 |
| **P2** | Agent stale detection | §8.4 |
| **P3** | Pagination / cursor-based loading | §8.7 |
| **P3** | Quick create from command palette (`Cmd+K`) | 前端 only |
