# Workflow Rules — 文件系统驱动的 Agent 行为规则注入

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/README.md` and the format specified in PLANS.md.


## Purpose / Big Picture

当前 Cradle 的 Agent 被委派 Issue 后，只收到 Issue 的标题、描述、上下文引用等原始内容，没有任何流程规范或行为约束。Agent 不知道团队的工作流程偏好，例如："处理完 Bug 后必须先将 Issue 移至 Review 列，而非直接移至 Done"、"所有代码变更必须附带测试用例说明"、"回复时使用中文"。

实现本计划后，用户可以为每个工作区（workspace）定义全局 Workflow Rules（Markdown 格式），还可以为特定 Agent Profile 在特定工作区下定义附加规则。当 Agent 被委派处理 Issue 时，系统自动从 `~/.cradle/` 目录中读取：

1. 该 Issue 所属工作区的全局 Workflow Rules
2. 该 Agent Profile 在该工作区的专属 Workflow Rules

两份规则合并后，作为 **User Message** 注入到 Agent 对话中（紧跟 Issue 内容之后），让 Agent 了解并遵守团队的流程规范。

关键设计决策：
- 规则存储在 **`~/.cradle/` 文件系统** 中，作为 Cradle 的全局用户配置目录。`~/.cradle/` 是 Cradle 的专属目录，未来版本控制由 Cradle 自行管理。
- 注入方式为 **User Message**（不是 System Prompt），因为将规则塞入 system prompt 会破坏 AI provider 的 prompt caching，增加 token 消耗。作为 user message 注入不影响 system prompt 的缓存命中率。
- 本阶段不做 UI 编辑器，不做模板变量替换（如 `{{agent_name}}`）。模板变量功能留到后续迭代。

验证方式：在 `~/.cradle/workflows/{workspaceId}/rules.md` 中写入全局规则 "回复时请使用中文"，然后委派一个 Issue 给 Agent。Agent 在处理时应收到该规则并以中文回复。在 Agent 的聊天记录中可以看到注入的 workflow rules user message。


## Progress

- [x] (2026-04-27 14:30Z) 设计 `~/.cradle/workflows/` 目录结构
- [x] (2026-04-27 14:35Z) 实现后端 service：`src/main/lib/workflow-rules.ts`（文件读写）
- [x] (2026-04-27 14:35Z) 实现 IPC service：`src/main/services/workflow-rules.ts`，注册到 `index.ts` 和 `ipc-types.ts`
- [x] (2026-04-27 14:40Z) 在 IssueAgentRunner.run() 中集成 workflow rules 注入逻辑（含 agentId 传递）
- [x] (2026-04-27 14:40Z) 提供 IPC handler 供前端调用
- [x] (2026-04-27 15:00Z) 修复 Agent vs Provider 混淆：delegation 链传递 agentId（issue-detail → use-kanban → kanban.ts → IssueAgentRunner）
- [x] (2026-04-27 15:10Z) 前端 UI 迁移至 workspace 详情页 Tab 系统（Overview + Workflow Rules）
- [x] (2026-04-27 15:10Z) 实现 `workspace-workflow-rules.tsx`：Agent scope 选择器 + 规则编辑器
- [x] (2026-04-27 15:15Z) 清理：删除弃用的 `workflow-rules-settings.tsx`，更新 README
- [ ] 端到端测试：Agent 处理 Issue 时收到注入的 workflow rules


## Surprises & Discoveries

- Agent Profile ≠ Agent Identity：最初混淆了 `agentProfiles`（Provider 连接配置）和 `agents`（Agent 身份层）。前端 scope selector 和 delegation 链都需要使用 `agents` 表的 ID，而非 `agentProfiles`。
- UI 位置变更：最初按 ExecPlan 放在 Settings 页面，用户反馈 Workflow Rules 应放在 Workspace 详情页（项目级配置，非全局设置）。


## Decision Log

- Decision: Workflow Rules 存储在 `~/.cradle/` 文件系统中
  Rationale: 用户最终决定使用 `~/.cradle/` 作为 Cradle 的全局用户配置目录。版本控制不依赖 git，而是由 Cradle 自行管理（后续实现）。`~/.cradle/` 是 Cradle 的专属目录，所有 workspace 的 workflow rules 按 workspaceId 组织在子目录中。这比数据库方案更透明——用户可以直接用文本编辑器查看和修改规则文件。
  Date: 2026-04-27

- Decision: 两个维度——工作区级全局 + Agent Profile 级专属
  Rationale: 工作区级全局规则（workspace-level）适用于所有 Agent，是团队的通用流程规范。Agent Profile 级规则是特定 Agent 的额外约束，与全局规则合并（追加）。例如全局规则说 "使用中文回复"，某个 Agent Profile 还额外要求 "代码变更前先列出影响范围"。运行时合并逻辑：workspace global rules + agent profile specific rules（按顺序拼接）。文件结构通过目录层级自然表达这两个维度。
  Date: 2026-04-27

- Decision: 以 User Message 注入，不插入 System Prompt
  Rationale: 用户明确要求 "作为 User Message 注入，不要插 system prompt 里面，这会影响 prompt caching"。AI provider（如 Anthropic）对 system prompt 有 prompt caching 机制，修改 system prompt 内容会导致缓存失效。Workflow rules 可能频繁修改（用户随时调整流程规范），而 system prompt 应保持稳定。将 rules 作为 user message 注入可以让 system prompt 继续被缓存，同时 Agent 仍能看到规则内容。
  Date: 2026-04-27

- Decision: 本阶段不实现 UI 编辑器和模板变量
  Rationale: 用户确认 "后续再做 Markdown 内部模板运行时动态替换"。当前先实现核心数据存取和注入机制，UI 层面提供最简单的 Markdown 文本编辑区域（textarea）即可。模板变量（如 `{{agent_name}}`、`{{issue_title}}`）需要定义变量体系和运行时替换逻辑，复杂度较高，留到后续迭代。
  Date: 2026-04-27


## Outcomes & Retrospective

**完成状态**：核心功能全部实现，端到端测试待执行。

**交付物**：
- 后端：`~/.cradle/workflows/` FS service + IPC service（CRUD），路径遍历防护
- 注入链：delegation 传递 agentId → IssueAgentRunner 读取 rules → 追加到 user message prompt
- 前端：workspace 详情页 Tab 系统（custom motion spring 滑动指示器），WorkspaceWorkflowRules 编辑器（全局 + Agent Identity scope selector）

**偏差与教训**：
1. Agent vs Provider 混淆：初始实现错误使用 agentProfiles（Provider）作为 scope selector，实际应该用 agents 表（Agent Identity）。delegation 链也需要传递 agentId（不仅是 agentProfileId）
2. UI 位置变更：ExecPlan 写的是 Settings 页面，用户反馈应放在 workspace 详情页（项目级配置）。Tab 系统后来从 Radix Tabs 替换为 custom motion spring tab bar
3. 文件路径从 `agents/{agentProfileId}.md` 变为 `agents/{agentId}.md`，与 Agent Identity 对齐


## Context and Orientation

以下是实现本功能涉及的关键模块和概念。

**`~/.cradle/` 目录** 是 Cradle 的全局用户配置目录，位于用户 home 目录下。这是一个应用专属目录，用于存放所有 workspace 共享的配置和数据。当前该目录可能尚不存在，服务启动时需自动创建。在 macOS 上展开为 `/Users/<username>/.cradle/`。

**Workflow Rules 文件结构**。每个 workspace 的规则按 workspaceId 组织在子目录中。全局规则使用固定文件名 `rules.md`，Agent Profile 专属规则使用 Profile ID 作为文件名：

    ~/.cradle/
      workflows/
        {workspaceId}/
          rules.md                    # workspace 全局规则（适用于所有 Agent）
          agents/
            {agentProfileId}.md       # Agent Profile 专属规则（仅适用于该 Profile）

例如，workspace ID 为 `abc123`，Agent Profile ID 为 `profile-001`：

    ~/.cradle/
      workflows/
        abc123/
          rules.md                    # 全局规则
          agents/
            profile-001.md            # profile-001 的专属规则

运行时合并逻辑：读取 `rules.md`（全局）+ 读取 `agents/{agentProfileId}.md`（专属），两者内容按顺序拼接。如果文件不存在视为空规则（不报错）。

**Workspace（工作区）** 是 Cradle 中的顶层组织单位，对应用户的一个项目目录。每个 workspace 有自己的 Kanban 看板、Issue 和 Agent 配置。数据库表 `workspaces` 定义在 `src/main/db/schema.ts`（约 L15-L27），关键字段包括 `id`（text PK）、`name`、`path`（本地路径）。

**Agent Profile（Agent 配置档案）** 定义了一个 AI provider 的连接配置。表 `agentProfiles` 在 `src/main/db/schema.ts`（约 L72-L84），字段包括 `id`、`name`、`providerKind`（`'acp-chat' | 'cli-tui' | 'openai-compatible'`）、`configJson`（JSON，存储 API key、endpoint 等）。一个 Agent Profile 可以被多个 Agent Identity 引用。

**IssueAgentRunner**（`src/main/lib/issue-agent-runner.ts`）：Issue 被委派后的执行器。`run()` 方法调用 `buildPrompt(issue)` 构建用户消息，然后调用 `ChatEngine.createAndSend()` 创建聊天会话。`buildPrompt()` 目前输出格式：

    # Issue: {title}
    
    {description}
    
    ## Context
    - [{type}] {label or value}
    
    Labels: bug, frontend
    Priority: high
    
    Please work on this issue. When done, summarize what you changed.

Workflow Rules 的注入点在 `run()` 方法中 `buildPrompt()` 调用之后——从文件系统读取规则内容，追加到 prompt 文本末尾。

**ChatEngine.createAndSend()**（`src/main/lib/chat-engine.ts`，约 L198-L240）接受参数：`{ agentId, workspaceId, cwd, text, modelId?, thinkingEffort?, agentIdentityId? }`。其中 `text` 是用户消息文本。当前 `IssueAgentRunner` 把 `buildPrompt()` 的结果作为 `text` 传入。


## Plan of Work

工作分为三个阶段：文件系统服务、注入集成、前端界面。不需要数据库 migration。

**阶段一：文件系统 Service**。创建 `src/main/lib/workflow-rules.ts`（或 `src/main/services/workflow-rules-service.ts`），提供对 `~/.cradle/workflows/` 目录的读写操作。

核心方法：

- `getWorkflowRules(workspaceId, agentProfileId?)` —— 读取文件系统中的规则。先读 `~/.cradle/workflows/{workspaceId}/rules.md`（全局），再读 `~/.cradle/workflows/{workspaceId}/agents/{agentProfileId}.md`（专属），返回两者内容。文件不存在时返回 null（不报错）。
- `saveWorkflowRule(workspaceId, agentProfileId | null, content)` —— 写入规则文件。如果 agentProfileId 为 null，写入 `rules.md`；否则写入 `agents/{agentProfileId}.md`。自动创建目录结构。
- `deleteWorkflowRule(workspaceId, agentProfileId | null)` —— 删除规则文件。
- `listWorkflowRules(workspaceId)` —— 列出该 workspace 下所有规则文件（全局 + 所有 agent profile 专属）。

获取 `~/.cradle/` 路径的方式：使用 Electron 的 `app.getPath('home')` 拼接 `.cradle`，或使用 Node.js 的 `os.homedir()`。

**阶段二：注入集成**。修改 `src/main/lib/issue-agent-runner.ts` 的 `run()` 方法，在 `buildPrompt()` 调用之后，从文件系统读取 workflow rules 并追加到 prompt 文本。拼接逻辑：

1. 调用 `getWorkflowRules(issue.workspaceId, agentSession.agentProfileId)`
2. 如果全局规则或 profile 专属规则有内容，拼接为一段文本：

       ---
       ## Workflow Rules
       
       {全局规则内容}
       
       {Agent Profile 专属规则内容}
       ---

3. 将此文本追加到 `buildPrompt()` 返回的 text 末尾。

关键：这些内容最终通过 `ChatEngine.createAndSend({ text: ... })` 作为 user message 发送，不会进入 system prompt。

**阶段三：前端最简设置界面**。在设置页面（Settings）或 Workspace 设置区域中，添加 Workflow Rules 编辑区。界面极简：

- 一个 textarea 编辑全局规则
- 一个 Agent Profile 选择器 + textarea 编辑 profile 级规则
- 保存时通过 IPC 调用后端 `saveWorkflowRule` 写入文件

需要 IPC handler 暴露 CRUD 操作给 renderer 进程。


## Concrete Steps

所有操作在项目根目录 `/Users/wibus/dev/Cradle` 下执行。

1. 创建 `src/main/lib/workflow-rules.ts`，实现文件系统读写。核心逻辑：

       import { homedir } from 'node:os'
       import { join } from 'node:path'
       import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises'
       
       const CRADLE_DIR = join(homedir(), '.cradle')
       const WORKFLOWS_DIR = join(CRADLE_DIR, 'workflows')
       
       function getGlobalRulePath(workspaceId: string) {
         return join(WORKFLOWS_DIR, workspaceId, 'rules.md')
       }
       
       function getAgentRulePath(workspaceId: string, agentProfileId: string) {
         return join(WORKFLOWS_DIR, workspaceId, 'agents', `${agentProfileId}.md`)
       }
       
       export async function getWorkflowRules(workspaceId: string, agentProfileId?: string) {
         let global: string | null = null
         let profileSpecific: string | null = null
         
         try { global = await readFile(getGlobalRulePath(workspaceId), 'utf-8') }
         catch { /* 文件不存在，返回 null */ }
         
         if (agentProfileId) {
           try { profileSpecific = await readFile(getAgentRulePath(workspaceId, agentProfileId), 'utf-8') }
           catch { /* 文件不存在，返回 null */ }
         }
         
         return { global, profileSpecific }
       }
       
       export async function saveWorkflowRule(workspaceId: string, agentProfileId: string | null, content: string) {
         const filePath = agentProfileId
           ? getAgentRulePath(workspaceId, agentProfileId)
           : getGlobalRulePath(workspaceId)
         await mkdir(join(filePath, '..'), { recursive: true })
         await writeFile(filePath, content, 'utf-8')
       }

   注意：文件路径中使用 workspaceId 和 agentProfileId 作为文件名/目录名。这些 ID 是 UUID 格式，安全用于文件名（无特殊字符）。必须对 ID 做基本的路径遍历防护（验证不含 `..`、`/` 等）。

2. 在 IPC handler 中注册 workflow rules 的 CRUD 操作。参照项目中已有的 IPC handler 注册模式（如 `src/main/ipc/` 目录下的其他 handler）。

3. 修改 `src/main/lib/issue-agent-runner.ts`：

   在 `run()` 方法中，在调用 `ChatEngine.createAndSend()` 之前，读取 workflow rules 并追加到 prompt 文本：

       const prompt = this.buildPrompt(issue)
       
       // 读取 workflow rules
       const rules = await getWorkflowRules(
         issue.workspaceId,
         agentSession.agentProfileId
       )
       
       let fullText = prompt
       if (rules.global || rules.profileSpecific) {
         fullText += '\n\n---\n## Workflow Rules\n\n'
         if (rules.global) fullText += rules.global + '\n\n'
         if (rules.profileSpecific) fullText += rules.profileSpecific + '\n'
         fullText += '---'
       }
       
       // 然后用 fullText 替换 prompt 传入 createAndSend

4. 实现前端设置页面。在 workspace 设置区域添加 Workflow Rules 编辑 UI，使用 TanStack Query 的 mutation hook 调用 IPC handler 保存数据。

5. 端到端验证：启动应用，在设置中为当前 workspace 输入全局 workflow rule "请使用中文回复所有内容"，保存。检查 `~/.cradle/workflows/{workspaceId}/rules.md` 文件是否被正确创建。然后在 Kanban 中创建 Issue 并委派给 Agent。查看 Agent 聊天记录，确认 user message 中包含 Workflow Rules 区块，且 Agent 按规则使用中文回复。


## Validation and Acceptance

1. **文件系统验证**：保存 workflow rule 后，在终端中检查文件是否存在及内容是否正确：

       cat ~/.cradle/workflows/{workspaceId}/rules.md

   预期输出为用户编写的 Markdown 规则内容。

2. **CRUD 验证**：通过前端 UI 创建全局规则和 Agent Profile 级规则。确认写入了两个文件：`rules.md` 和 `agents/{agentProfileId}.md`。更新规则时文件内容被覆盖。删除规则时文件被移除。

3. **注入验证**：委派 Issue 给 Agent 后，在 Agent 的聊天会话中，第一条 user message 应包含 Issue 内容和 Workflow Rules。格式示例：

       # Issue: Fix login page layout
       
       The login button is misaligned on mobile devices.
       
       ...
       
       ---
       ## Workflow Rules
       
       请使用中文回复所有内容。
       
       处理完成后请将 Issue 移至 Review 状态。
       ---

4. **规则合并验证**：同时设置 workspace 全局规则和 Agent Profile 级规则。委派 Issue 时，两条规则都应出现在 user message 中，全局规则在前，Profile 级在后。

5. **空规则处理**：如果 `~/.cradle/workflows/{workspaceId}/` 目录不存在或文件不存在，Agent 收到的 user message 应与之前完全一致（无 "Workflow Rules" 区块），不应报错。


## Idempotence and Recovery

- 文件写入操作是幂等的——重复写入相同内容不会产生副作用。
- `mkdir({ recursive: true })` 是幂等的——目录已存在时不报错。
- 如果 `~/.cradle/` 目录损坏或被误删，服务应在下次写入时自动重建目录结构。
- 如果注入逻辑有 bug，Agent 的 user message 可能包含错误的格式。但这不会造成数据损坏——只需修复注入逻辑并重新委派 Issue 即可。
- 所有文件操作使用 async fs API，不会阻塞主进程。


## Artifacts and Notes

**IssueAgentRunner.buildPrompt() 当前实现**（`src/main/lib/issue-agent-runner.ts`，约 L130-L166）：

    buildPrompt(issue) {
      let prompt = `# Issue: ${issue.title}\n\n`
      if (issue.description) prompt += `${issue.description}\n\n`
      // ... context refs, labels, priority
      prompt += `\nPlease work on this issue. When done, summarize what you changed.`
      return prompt
    }

注入点在 `run()` 方法中 `buildPrompt()` 调用之后。`buildPrompt()` 的职责保持为 "构建 Issue 内容"，而 workflow rules 的获取和拼接逻辑属于 orchestration 层。

**安全注意事项**：workspaceId 和 agentProfileId 用于构造文件路径，必须验证这些 ID 不包含路径遍历字符（`..`、`/`、`\`）。UUID 格式的 ID 天然安全（只含字母数字和连字符），但应在 service 层做防御性检查。


## Interfaces and Dependencies

**文件系统结构**：

    ~/.cradle/
      workflows/
        {workspaceId}/
          rules.md                    # workspace 全局规则
          agents/
            {agentProfileId}.md       # Agent Profile 专属规则

**新增模块**（`src/main/lib/workflow-rules.ts`）：

    export async function getWorkflowRules(workspaceId: string, agentProfileId?: string):
      Promise<{ global: string | null, profileSpecific: string | null }>
    
    export async function saveWorkflowRule(workspaceId: string, agentProfileId: string | null, content: string):
      Promise<void>
    
    export async function deleteWorkflowRule(workspaceId: string, agentProfileId: string | null):
      Promise<void>
    
    export async function listWorkflowRules(workspaceId: string):
      Promise<Array<{ type: 'global' | 'agent', agentProfileId?: string, content: string }>>

**修改的模块**：

- `src/main/lib/issue-agent-runner.ts` —— `run()` 方法中追加 workflow rules 注入
- `src/main/ipc/` —— 新增 IPC handler（或在现有 handler 中扩展）
- `src/renderer/src/features/` —— 新增设置 UI 组件（位置待定，可能在 workspace 设置页面）

**依赖**：

- Node.js `fs/promises`（内置）—— 文件读写
- Node.js `os`（内置）—— `homedir()` 获取用户目录
- TanStack Query（已安装）—— 前端数据获取
- 无新外部依赖，不需要数据库 migration
