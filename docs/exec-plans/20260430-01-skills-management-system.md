# ExecPlan: Skills 管理系统

> ID: `20260430-01-skills-management-system`
> Status: Draft
> Created: 2026-04-30
> Depends-on: 20260427-03-system-prompt-skills-injection (✅ Complete), 20260428-01-builtin-system-workflow-and-skills (✅ Complete)

---

## 背景

当前 Cradle 已经具备两项关键基础能力：

- `src/main/lib/skills.ts` 已支持 built-in → user (`~/.agents/skills`) → project (`{workspace}/.agents/skills`) 三层扫描与覆盖。
- `src/main/lib/chat-engine.ts` 已把 skills catalog 追加到非 ACP provider 的 system prompt 中。

缺口不在“是否有 skills 数据模型”，而在“如何把已有 filesystem-based skill 体系做成可管理的产品能力”：

- 缺少 Global / Workspace 两层的 Skills 管理 UI
- 缺少 Skill 创建、编辑、删除能力
- 缺少 Agent 级 Skills 配置
- 缺少 import / export 能力

这套能力必须沿着当前项目的文件系统边界继续扩展，而不是引入一套 DB 作为 Skills 的主存储。`SKILL.md` 目录结构本身就是兼容格式，也是与 agentskills.io 风格对齐的 source of truth。

---

## 直接结论

**Skills 的 canonical storage 继续使用目录 + `SKILL.md` 文件，不新增 `skills` / `agent_skills` 表。**

- Global Skills 直接管理 `~/.agents/skills/`
- Workspace Skills 直接管理 `{workspacePath}/.agents/skills/`
- Built-in Skills 继续来自 `resources/skills/`，只读展示
- Per-agent Skills 只在 `agents.configJson` 中保存“选择规则 / 引用”，不保存 skill 正文

也就是说：

```text
skill content      -> filesystem
skill package      -> filesystem directory
skill override     -> filesystem tier priority
agent skill policy -> agents.configJson
```

---

## 核心设计

### D1: Skills 是文件包，不是数据库实体

每个 Skill 的最小单元继续保持为：

```text
<scope-root>/<skill-name>/
  SKILL.md
  references/...
  scripts/...
  assets/...
```

其中 `SKILL.md` 继续采用：

```md
---
name: skill-name
description: Short description
---

# Body
...
```

Cradle 对 skill 的创建、编辑、删除，本质上都是对这个目录树的文件系统操作。

这样做的收益：

- 与现有 `scanSkills()` 完全同构，不需要第二套读取路径
- import/export 几乎退化为目录复制，天然兼容 `.agents/skills/`
- Workspace skills 天然受 Git 管理，版本历史交给仓库本身
- 用户可以在 Cradle 外部直接编辑 skill 文件，不会形成“双写源”

### D2: 管理层级直接映射到现有扫描层级

L1 只支持三层来源：

1. **Built-in**: `resources/skills/`
   - 只读
   - 用于展示系统内置技能
2. **Global**: `~/.agents/skills/`
   - 可 CRUD
   - 跨 workspace 可见
3. **Workspace**: `{workspacePath}/.agents/skills/`
   - 可 CRUD
   - 仅当前 workspace 生效

运行时优先级保持不变：

```text
built-in < global < workspace
```

同名覆盖继续由目录层级决定，而不是在 UI 或 DB 层重复实现一套覆盖逻辑。

### D3: Agent Skills 配置存“引用”，不存“内容”

Agent 身份当前已经是 DB 实体，且已有 `configJson` 扩展位。L1 在 `configJson` 中新增一段 Skills 配置即可，不新增表：

```json
{
  "systemPrompt": "You always respond as a pirate.",
  "skills": {
    "mode": "inherit",
    "selected": [
      { "scope": "global", "name": "cradle-cli" },
      { "scope": "workspace", "name": "repo-conventions" }
    ]
  }
}
```

约定：

- `mode: "inherit"`：沿用当前行为，注入当前 session 可见的全部 skills
- `mode: "selected"`：只注入 `selected` 中声明的 skills

`selected` 存的是稳定引用：

- `scope`: `builtin | global | workspace`
- `name`: skill frontmatter 中的 `name`

不存绝对路径，避免 workspace 移动后引用失效。

### D4: Agent 不引入自己的 workspace 概念

“Agent 是否应该拥有自己的 workspace” 这个问题，L1 结论是 **不需要**。

原因：

- 当前会话上下文已经由 `session.workspaceId` 确定
- Skill 的 project-level 可见性天然依赖当前 workspace
- 如果再给 agent 增加一个独立 workspace，会把 session/workspace/agent 三者的边界搅乱

因此：

- **Agent identity** 仍然是全局对象
- **Workspace visibility** 仍然由当前 session 决定
- **Agent skills config** 只是对当前可见 skills 做筛选，不创造新的文件系统根

### D5: 不做应用内版本管理，不做 Skill 依赖图

L1 明确不做：

- App 内 Skill revision history
- Skill-to-skill dependency resolution
- DB snapshot / migration for skills

理由：

- Workspace skills 的版本历史交给 Git
- Global skills 的版本历史交给用户自己的 dotfiles / sync 方案
- 引入依赖图会强迫 Skill 包格式升级，并把当前“读文件即可使用”的简单模型推向 package manager

L1 允许前向兼容：

- frontmatter 中可以保留未来字段，如 `version`、`requires`
- 运行时先忽略未知字段，不做解析语义

---

## 运行时模型

### Skill inventory

需要把当前 `SkillCatalogEntry` 扩展成更完整的 inventory 项，至少包含：

```ts
interface SkillInventoryEntry {
  name: string
  description: string
  scope: 'builtin' | 'global' | 'workspace'
  location: string
  rootDir: string
  skillDir: string
}
```

`scanSkills(workspacePath?)` 继续负责“按优先级去重后的可见技能目录”。

同时新增一个更底层的能力，例如：

- `listSkillInventory(workspacePath?)`

用于 UI 展示分层来源、覆盖关系、导入目标选择等。

### 注入逻辑

非 ACP provider 下的最终 skills catalog 计算规则：

1. 根据 session 解析当前 workspace path
2. 扫描 built-in/global/workspace 技能清单
3. 读取 `session.agentId -> agents.configJson.skills`
4. 若 `mode === "inherit"`，注入全部可见技能
5. 若 `mode === "selected"`，按 `scope + name` 过滤后注入
6. 丢弃当前 workspace 下不存在的失效引用，并在 UI 标为 invalid reference

ACP provider 继续保持不注入，由其自身 runtime 管理。

---

## IPC / 后端设计

### Milestone 1: 扩展 `src/main/lib/skills.ts`

完成后，skills 模块同时承担：

- 扫描目录
- 解析 frontmatter
- 读取单个 skill
- 写入 / 删除单个 skill
- import / export

建议新增能力：

- `listSkillInventory(workspacePath?: string): SkillInventoryEntry[]`
- `getSkill(scope, name, workspacePath?): SkillDocument`
- `createSkill(scope, input, workspacePath?): SkillDocument`
- `updateSkill(scope, previousName, input, workspacePath?): SkillDocument`
- `deleteSkill(scope, name, workspacePath?): void`
- `importSkill(scope, sourceDir, workspacePath?): SkillDocument`
- `exportSkill(scope, name, targetDir, workspacePath?): string`

其中：

- `scope === "builtin"` 只允许读，不允许写
- `scope === "global"` 目标根目录为 `~/.agents/skills`
- `scope === "workspace"` 目标根目录为 `{workspacePath}/.agents/skills`

### Milestone 2: 新增 `src/main/services/skills.ts`

新增 IPC service，职责与 `workflow-rules.ts` 类似，但面向 skill package：

- `skills.list(workspaceId?)`
- `skills.get(params)`
- `skills.create(params)`
- `skills.update(params)`
- `skills.delete(params)`
- `skills.import(params)`
- `skills.export(params)`

这里参数应传 `workspaceId` 而不是 renderer 直接传路径，由 main process 负责从 DB 解析 workspace path，维持边界一致。

### Milestone 3: Agent config 扩展，不新增 migration

复用现有：

- `src/main/services/agent.ts`
- `src/main/db/schema.ts` 中的 `agents.configJson`

只扩展 `CreateAgentInput` / `UpdateAgentInput` 的配置约定，不增加新表。

需要补充：

- config parser / serializer helper，避免 renderer 直接到处手写 `JSON.parse`
- 对失效 skill refs 的容错与清理策略

---

## 前端设计

### Milestone 4: Global Skills 管理页

建议落在 Settings 内，和 Agent / Runtime 管理并列，而不是混进 DB 风格的资源页。

界面职责：

- 展示 Built-in / Global 两组清单
- Built-in 只读
- Global 支持创建、编辑、删除、导入、导出
- 显示覆盖信息，例如某个 global skill 是否被当前 workspace 同名覆盖

### Milestone 5: Workspace Skills 管理页

建议落在 `workspace-detail`，与 `Workflow Rules` 并列。

理由：

- Workspace skill 本质上就是项目文件的一部分
- 这里已经有 `useWorkspaceFile()`、`MarkdownEditor`、项目级文档编辑上下文
- 用户在项目视角下编辑 `.agents/skills/` 更自然

界面职责：

- 仅管理当前 workspace 下的 `.agents/skills/`
- 创建 / 编辑 / 删除 workspace skill
- 显示该 skill 是否覆盖 global / built-in 同名 skill

### Milestone 6: Skill 编辑器

编辑器不应把 frontmatter 当成一整块原始文本塞给用户，而应做双层表达：

1. **Structured fields**
   - `name`
   - `description`
2. **Markdown body editor**
   - 编辑 `--- ... ---` 之后的正文

保存时重新拼回完整 `SKILL.md`。

可选增强：

- Raw mode：允许高级用户直接查看完整文件文本
- 只在必要时校验 frontmatter 字段，不替用户重写未知字段

### Milestone 7: Agent Skills 配置 UI

放在 Agent 编辑 UI 中，而不是 Workspace 详情页。

每个 Agent 提供：

- `Use all visible skills`（默认）
- `Use selected skills only`

当切到 selected 模式时：

- 展示 built-in/global/workspace 三组可选 skill
- 当前 workspace 不可见的 workspace 引用显示为 invalid，仅可移除

---

## Import / Export 设计

### Import

输入源直接兼容 `.agents/skills/<name>/` 目录：

- 选择一个 skill 目录
- 校验存在 `SKILL.md`
- 解析 frontmatter
- 复制整个目录到目标 scope

支持目标：

- import 到 global
- import 到当前 workspace

若同名已存在：

- 默认阻止覆盖
- 允许显式 replace

### Export

export 不需要特殊格式转换，直接复制 skill 目录即可。

导出目标可以是：

- 任意本地目录
- 用户自己的 `.agents/skills/` 仓库目录

这保证 Cradle 的导出物仍然是标准 skill package，而不是私有 JSON blob。

---

## 验收标准

1. 在 Settings 新建一个 Global skill，保存后磁盘出现 `~/.agents/skills/<name>/SKILL.md`
2. 在 Workspace Detail 新建一个 Workspace skill，保存后磁盘出现 `{workspace}/.agents/skills/<name>/SKILL.md`
3. Workspace skill 与 Global skill 同名时，运行时 catalog 只注入 workspace 版本
4. Agent A 配置为 `selected` 且只选中 Skill X；在同一 workspace 聊天时 catalog 仅包含 Skill X
5. Agent B 配置为 `inherit`；在同一 workspace 聊天时 catalog 包含全部当前可见 skills
6. 导入一个现有 `.agents/skills/foo/` 目录后，UI 能立即看到并编辑，运行时注入正常
7. 导出 skill 后，目标目录仍然保持标准 `SKILL.md` package 结构

---

## 验证方式

- 单元测试：
  - `src/main/lib/__tests__/skills.test.ts`
  - 覆盖扫描优先级、frontmatter 解析、create/update/delete、import/export、invalid ref 过滤
- 服务测试：
  - `src/main/services/__tests__/skills.test.ts`
  - 覆盖 `workspaceId -> path` 解析、scope 权限、builtin 只读约束
- 集成测试：
  - `src/main/lib/__tests__/chat-engine.test.ts`
  - 覆盖 `inherit` 与 `selected` 两种 agent skills 模式下的 catalog 注入
- Renderer 测试：
  - Global Skills 页 CRUD
  - Workspace Skills 页 CRUD
  - Agent Skills 选择器行为

---

## 非目标

- Skill 内容存入 SQLite / Drizzle
- `skills` / `agent_skills` 关系表
- Agent 自己的 workspace 根目录
- Skill 版本管理
- Skill 依赖关系解析
- Marketplace / 远程分发系统
