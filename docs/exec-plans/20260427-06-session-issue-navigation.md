# Session ↔ Issue 双向导航

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/README.md` and the format specified in PLANS.md.


## Purpose / Big Picture

当前 Cradle 中 Agent 处理 Issue 时会创建一个聊天会话（chat session），但聊天界面和 Kanban 看板是割裂的两个世界：

- **Issue → Chat（已实现）**：在 Issue 详情面板的 Agent Session Feed 中，可以点击 "View session" 链接跳转到对应的聊天会话页面。
- **Chat → Issue（缺失）**：在聊天界面中，用户无法知道当前会话关联了哪个 Issue，也无法快速跳转回 Kanban 查看 Issue 详情。

实现本计划后，聊天界面的右侧边栏（RightAside）将新增一个 **Issue 标签页**，与现有的 Files 和 Git 标签页并列。当聊天会话关联了某个 Issue 时，该标签页显示 Issue 的状态、标题、优先级等关键信息，并提供快捷入口跳转到 Kanban 面板。

此外，对于未自动关联 Issue 的普通聊天会话，用户可以通过 "Link issue" 按钮手动关联一个 Issue。这实现了 Chat ↔ Issue 的完整双向导航：从任何一侧都能快速到达另一侧。

验证方式：委派一个 Issue 给 Agent，Agent 创建聊天会话后，打开该聊天会话。右侧边栏的 Issue 标签页自动显示关联 Issue 的标题和状态。点击 Issue 标题可跳转到 Kanban 面板。


## Progress

- [x] (2026-04-27 16:00Z) 设计 chat session ↔ issue 的关联查询方案（agentSessions 反查 + sessions.linkedIssueId 手动链接）
- [x] (2026-04-27 16:05Z) DB migration 0015: sessions 表新增 linkedIssueId 字段
- [x] (2026-04-27 16:05Z) schema.ts 更新 sessions 表定义
- [x] (2026-04-27 16:10Z) 实现后端 IPC：getLinkedIssue（先查 agentSessions，再查 sessions.linkedIssueId）
- [x] (2026-04-27 16:10Z) 实现后端 IPC：linkIssueToSession / unlinkIssueFromSession
- [x] (2026-04-27 16:15Z) 前端 hooks：useLinkedIssue, useLinkIssue, useUnlinkIssue
- [x] (2026-04-27 16:20Z) 创建 IssueAsidePanel 组件（LinkedIssueView + EmptyState + IssuePicker）
- [x] (2026-04-27 16:20Z) 修改 RightAside 组件，新增 Issue 标签页 + sessionId prop
- [x] (2026-04-27 16:25Z) chat.$sessionId.lazy.tsx 传递 sessionId 给 RightAside
- [ ] 端到端测试：自动关联和手动关联场景


## Surprises & Discoveries

- agentSessions.agentProfileId 是 NOT NULL，手动关联无法复用 agentSessions 表。采用方案 A：在 sessions 表新增 nullable `linkedIssueId` 字段，查询时先查 agentSessions（自动关联），再回退查 sessions.linkedIssueId（手动关联）。
- kanbanIssues 无直接 boardId——Issue 通过 workspaceId 归属。Chat → Kanban 导航需先取 workspace 的第一个 board，再导航到 `/kanban/$boardId?issue=<issueId>`。


## Decision Log

- Decision: 新增 Issue 标签页到 RightAside（与 Files、Git 并列），而非在聊天界面主区域显示
  Rationale: RightAside 是聊天界面的辅助信息区域，已有 Files 和 Git 标签页。Issue 信息属于同一类 "上下文信息"，放在右侧边栏的标签页中既不占主区域空间，又保持了界面一致性。用户在聊天时可以随时切换查看 Issue 状态。
  Date: 2026-04-27

- Decision: 1:1 关联——一个 chat session 最多关联一个 Issue
  Rationale: 在 Agent 处理 Issue 的场景下，每次委派都会创建一个新的 chat session。一个 session 只处理一个 Issue。即使手动关联，也应保持 1:1 简单性。多对多关联（一个 session 关联多个 Issue）增加复杂度但当前没有使用场景。
  Date: 2026-04-27

- Decision: 手动关联通过 "Link issue" 按钮实现，提供 Issue 选择器
  Rationale: 用户可能在普通聊天会话中讨论了某个 Issue 的相关内容，想要建立关联以便日后追溯。"Link issue" 提供一个简单的 Issue 搜索/选择界面，选中后在 agentSessions 表中创建一条记录（或使用其他关联方式）。
  Date: 2026-04-27

- Decision: 通过现有 agentSessions 表反向查询实现关联，不在 sessions 表中新增 issueId 字段
  Rationale: `agentSessions` 表已有 `chatSessionId` 和 `issueId` 字段，可以通过 `chatSessionId` 反向查询到关联的 `issueId`。对于自动关联（Agent 委派场景），这条记录已自动创建。对于手动关联，需要创建一条新的 agentSessions 记录（status 可设为特殊值如 'linked'）。这种方式避免修改 sessions 表 schema，复用现有数据结构。但需评估是否语义合适——agentSessions 本意是追踪 Agent 执行会话，手动关联并非 Agent 执行。替代方案：在 sessions 表中新增 `issueId` 字段。两种方案各有取舍，实施时需最终确定。
  Date: 2026-04-27


## Outcomes & Retrospective

**完成状态**：核心功能全部实现，端到端测试待执行。

**交付物**：
- DB migration 0015：sessions 表新增 `linkedIssueId` nullable FK
- 后端：`getLinkedIssue`（双路查询：agentSessions 自动关联 + sessions.linkedIssueId 手动关联）、`linkIssueToSession`、`unlinkIssueFromSession`
- 前端：`IssueAsidePanel` 组件（显示关联 Issue 信息 + IssuePicker 手动关联 + Unlink 取消关联）
- RightAside：新增 Issue 标签页，接收 sessionId prop

**偏差与教训**：
1. 手动关联方案：ExecPlan 建议复用 agentSessions 表，但 agentProfileId 是 NOT NULL，手动关联无法填充。最终选择方案 A：sessions 表新增 `linkedIssueId`，语义更清晰
2. Chat → Kanban 导航：kanbanIssues 无 boardId，需通过 workspace 的第一个 board 中转导航


## Context and Orientation

以下是实现本功能涉及的关键模块和数据结构。

**RightAside 右侧边栏**（`src/renderer/src/components/layout/right-aside.tsx`，76 行）是聊天界面的辅助信息面板。当前有两个标签页：

- **Files**：显示当前工作区的文件树（`FileTree` 组件）
- **Git**：显示 Git 变更信息（`GitPanel` 组件）

标签页使用 motion/react 实现动画切换，标签栏是一排按钮，选中时有一个动画滑块（pill）高亮当前标签。组件接受 `workspaceId` 和 `workspacePath` 两个 props。

RightAside 的显示/隐藏由 Zustand store 控制（`useLayoutStore.asideOpen`）。它只在 `/chat/$sessionId` 路由下渲染，在 Kanban 路由下不显示。宽度可拖拽调整，范围 200-560px。

**agentSessions 表**（`src/main/db/schema.ts`，约 L308-L324）：

    id             - text PK (UUID)
    issueId        - text FK → kanbanIssues.id (cascade delete)
    agentProfileId - text FK → agentProfiles.id (restrict delete)
    chatSessionId  - text FK → sessions.id (set null on delete)
    status         - enum: 'created' | 'active' | 'completed' | 'stopped' | 'failed'
    createdAt      - integer
    updatedAt      - integer

当 Agent 被委派处理 Issue 时，`delegateIssue()` 创建一条 agentSessions 记录（status = 'created'），然后 `startSession()` 调用 `IssueAgentRunner.run()` 创建 chat session 并将 `chatSessionId` 写回 agentSessions 记录。因此，对于 Agent 处理的聊天会话，可以通过 `agentSessions.chatSessionId` 反向查询得到 `agentSessions.issueId`，进而获取关联的 Issue。

**sessions 表**（`src/main/db/schema.ts`，约 L31-L56）：没有 `issueId` 字段。聊天会话与 Issue 的关联完全通过 `agentSessions` 表的 `chatSessionId` 间接实现。

**kanbanIssues 表**：包含 Issue 的全部信息——`title`、`description`、`statusId`（FK → kanbanStatuses）、`priority`、`labels`（JSON）、`delegateAgentId` 等。

**路由结构**：聊天页面位于 `/chat/$sessionId` 路由。Kanban 面板位于 `/kanban` 路由。Issue 详情面板是 Kanban 页面内嵌的侧边面板（不是独立路由），通过选中 Issue 打开。从 Chat 跳转到 Kanban 的 Issue 需要导航到 `/kanban` 并在 URL 参数或 Zustand state 中传递 issueId 来自动打开详情面板。


## Plan of Work

工作分为三个阶段：后端查询、RightAside 改造、手动关联功能。

**阶段一：后端查询接口**。实现根据 chatSessionId 查询关联 Issue 的 IPC handler。核心查询逻辑：在 agentSessions 表中查找 `chatSessionId = 当前会话 ID` 的记录，如果找到则取出 `issueId`，再从 kanbanIssues 表中加载 Issue 详情（标题、状态、优先级等）。需要联表查询 kanbanStatuses 以获取状态名称。

这个查询应返回的数据结构：

    {
      issue: {
        id, title, description, statusId, statusName, statusColor,
        priority, labels, delegateAgentId
      },
      agentSession: {
        id, status, createdAt
      }
    } | null

如果没有关联 Issue（普通聊天会话），返回 null。

**阶段二：RightAside 新增 Issue 标签页**。在 `src/renderer/src/components/layout/right-aside.tsx` 中：

1. 在标签列表中新增 "Issue" 标签，与 "Files" 和 "Git" 并列。
2. 创建新的 `IssuePanel` 组件（可放在 `src/renderer/src/features/kanban/` 或 `src/renderer/src/components/layout/` 中）。
3. `IssuePanel` 接受 `sessionId` prop，调用后端 IPC 查询关联的 Issue。
4. 如果有关联 Issue，显示 Issue 信息卡片：标题、状态（带颜色标记）、优先级、Agent 执行状态等，以及 "Open in Kanban" 按钮。
5. 如果没有关联 Issue，显示空状态和 "Link issue" 按钮。

RightAside 需要新增一个 prop 或从路由中获取当前 sessionId。当前 RightAside 只接收 `workspaceId` 和 `workspacePath`，需要扩展。

**阶段三：手动关联功能**。实现 "Link issue" 交互：

1. 点击 "Link issue" 按钮弹出 Issue 选择器（可以是搜索框 + 列表，或简单的 Select/Combobox）。
2. 列表显示当前 workspace 的所有 Issue（或搜索结果）。
3. 选中后：在 agentSessions 表中创建一条记录（`chatSessionId = 当前会话 ID，issueId = 选中的 Issue ID`），或者如果决定在 sessions 表新增 issueId 字段，则直接更新 sessions 记录。
4. 关联后 Issue 标签页自动刷新显示关联的 Issue。
5. 提供 "Unlink" 按钮可取消关联。

关于手动关联的数据层：如果复用 agentSessions 表，需要一个新的 status 值（如 'linked'）来区分手动关联和 Agent 执行产生的关联。agentSessions 记录还需要 `agentProfileId` 字段（NOT NULL），手动关联时不存在 Agent Profile，这是一个 schema 兼容性问题。替代方案：

- 方案 A：在 sessions 表新增 nullable `linkedIssueId` 字段，单独管理手动关联。查询时合并——先查 agentSessions.chatSessionId，如果没找到再查 sessions.linkedIssueId。
- 方案 B：让 agentSessions.agentProfileId 变为 nullable，允许手动关联时 agentProfileId 为 null。

两种方案都可行。方案 A 更清晰（自动 vs 手动分开存储），方案 B 复用现有结构但混淆了 agentSessions 的语义。实施时需决定。


## Concrete Steps

所有操作在项目根目录 `/Users/wibus/dev/Cradle` 下执行。

1. 实现后端查询 IPC handler。在 `src/main/services/` 中（或 `src/main/ipc/`）添加方法：

       // getLinkedIssue(chatSessionId: string)
       // 查询 agentSessions where chatSessionId = ? 
       // 联表 kanbanIssues + kanbanStatuses
       // 返回 Issue 详情或 null

   IPC channel 名称参照项目已有命名约定（如 `kanban:getLinkedIssue`）。

2. 在 `src/renderer/src/features/kanban/` 或相关目录创建 `issue-aside-panel.tsx` 组件：

       // Input: sessionId from route params, IPC query for linked issue
       // Output: IssueAsidePanel component showing linked issue info
       // Position: Tab content in RightAside component

   组件实现：
   - 调用 `useQuery` 获取关联 Issue 数据
   - 有 Issue 时显示：状态标记 + 标题 + 优先级 + Agent 状态 + "Open in Kanban" 按钮
   - 无 Issue 时显示：空状态 + "Link issue" 按钮
   - "Open in Kanban" 使用 `useNavigate()` 导航到 `/kanban`，同时传递 issueId 以自动展开详情面板

3. 修改 `src/renderer/src/components/layout/right-aside.tsx`：

   - 在 `tabs` 数组中添加 `{ id: 'issue', label: 'Issue' }` 标签
   - 在标签内容渲染区域添加 `IssueAsidePanel` 组件
   - 新增 `sessionId` prop（或从 TanStack Router 的当前路由参数中获取）
   - 如果关联了 Issue，可考虑默认选中 Issue 标签页

4. 实现手动关联 IPC：

       // linkIssueToSession(chatSessionId: string, issueId: string)
       // unlinkIssueFromSession(chatSessionId: string)

   具体实现取决于阶段二中选定的数据层方案（sessions.linkedIssueId vs agentSessions 扩展）。

5. 实现 Issue 选择器 UI。在 `IssueAsidePanel` 中，"Link issue" 按钮点击后展开搜索/选择界面：

   - 调用 IPC 获取当前 workspace 的 Issue 列表
   - 显示为可选列表（标题 + 状态标记）
   - 选中后调用 `linkIssueToSession` IPC

6. 验证：启动应用，在 Kanban 中委派一个 Issue 给 Agent。打开 Agent 创建的聊天会话，检查右侧边栏 Issue 标签页是否显示关联的 Issue 信息。点击 "Open in Kanban" 确认跳转正确。


## Validation and Acceptance

1. **自动关联场景**：委派 Issue 给 Agent → Agent 创建聊天会话 → 打开该聊天会话 → RightAside 的 Issue 标签页自动显示 Issue 标题、状态、优先级。这证明后端查询通过 agentSessions.chatSessionId 正确找到了关联 Issue。

2. **手动关联场景**：创建一个普通聊天会话（不通过 Issue 委派）→ 打开该会话 → RightAside Issue 标签页显示 "No linked issue" 和 "Link issue" 按钮 → 点击 "Link issue"，选择一个 Issue → Issue 标签页刷新显示关联的 Issue 信息。

3. **导航验证**：在 Issue 标签页点击 "Open in Kanban" → 导航到 Kanban 页面 → Issue 详情面板自动打开显示该 Issue。这实现了 Chat → Issue 方向的导航闭环。

4. **反向导航验证**（已实现）：在 Kanban 的 Issue 详情面板的 Agent Session Feed 中，点击 "View session" → 导航到 Chat 页面。这与上述 Chat → Issue 导航共同构成完整的双向导航。

5. **取消关联**：在手动关联后，点击 "Unlink" → Issue 标签页恢复空状态。原 Issue 不受影响。

6. **无关联会话**：打开一个从未关联 Issue 的聊天会话，Issue 标签页应显示空状态，无报错。


## Idempotence and Recovery

- 后端查询是只读操作，天然幂等。
- 手动关联操作如果使用 sessions.linkedIssueId 方案，是幂等的（UPDATE 同一行，重复执行结果相同）。如果使用 agentSessions 方案，需注意不要重复创建记录——应先检查是否已存在。
- 如果 Issue 被删除（cascade 到 agentSessions），RightAside 的查询应优雅处理 null 返回。
- 如果 sessions 表新增了 linkedIssueId 字段，需要 Drizzle migration。回滚方式与 Workflow Rules 相同。


## Artifacts and Notes

**RightAside 当前结构概要**（`src/renderer/src/components/layout/right-aside.tsx`）：

    const tabs = [
      { id: 'files', label: 'Files' },
      { id: 'git', label: 'Git' },
    ]
    
    // 标签栏：按钮列表 + motion.div 动画 pill
    // 内容区：根据 activeTab 渲染 FileTree 或 GitPanel
    // Props: workspaceId, workspacePath

新增 Issue 标签后：

    const tabs = [
      { id: 'files', label: 'Files' },
      { id: 'git', label: 'Git' },
      { id: 'issue', label: 'Issue' },
    ]

**agentSessions 查询示例**：

    SELECT 
      as_.id as agentSessionId,
      as_.status as agentStatus,
      ki.id as issueId,
      ki.title,
      ki.priority,
      ki.labels,
      ks.name as statusName,
      ks.color as statusColor
    FROM agent_sessions as_
    JOIN kanban_issues ki ON ki.id = as_.issue_id
    JOIN kanban_statuses ks ON ks.id = ki.status_id
    WHERE as_.chat_session_id = ?

**路由导航到 Kanban 并打开 Issue**。当前 Kanban 面板使用 Zustand state（`useKanbanStore.selectedIssueId`）控制选中的 Issue。从 Chat 导航到 Kanban 时需要同时设置这个 state。一种做法是使用 URL search params（如 `/kanban?issueId=xxx`），在 Kanban 组件的 `useEffect` 中读取并更新 Zustand state。


## Interfaces and Dependencies

**可能的新 schema 变更**（取决于实施方案选择）：

方案 A — 在 sessions 表新增字段：

    ALTER TABLE sessions ADD COLUMN linked_issue_id TEXT REFERENCES kanban_issues(id) ON DELETE SET NULL

方案 B — agentSessions.agentProfileId 改为 nullable：

    -- 无需新增字段，但需修改 agentProfileId 的约束

**新增 IPC Channels**：

    kanban:getLinkedIssue(chatSessionId: string) → { issue, agentSession } | null
    kanban:linkIssueToSession(chatSessionId: string, issueId: string) → void
    kanban:unlinkIssueFromSession(chatSessionId: string) → void

**新增前端组件**：

    src/renderer/src/features/kanban/issue-aside-panel.tsx
      Props: sessionId: string, workspaceId: string
      Exports: IssueAsidePanel

**修改的模块**：

    src/renderer/src/components/layout/right-aside.tsx — 新增 Issue 标签页
    src/main/services/ 或 src/main/ipc/ — 新增 IPC handlers
    src/main/db/schema.ts — 可能新增字段（取决于方案选择）

**依赖**：

- TanStack Router（已安装）—— `useNavigate`, `useParams` 获取 sessionId
- TanStack Query（已安装）—— `useQuery` 获取关联 Issue
- motion/react（已安装）—— 标签页动画
- 无新外部依赖
