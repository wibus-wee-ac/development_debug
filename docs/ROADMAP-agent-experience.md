# Agent Experience Optimization Roadmap

> Status: Draft — 2026-04-30
> Owner: wibus
> Context: Cradle 当前已实现基础 Agent Runtime 和 Chat 功能，需要在 Skills 管理、Session 体验、沙箱隔离、多 Agent 协同方面进行系统性体验提升。

---

## L1 — Skills 管理系统

**里程碑**: 2026 W19 (5/5 - 5/11)

**动机**: Agent 效能的核心差异化来自 Skills（专业知识注入）。当前 Skills 扫描已实现但无管理界面、无 per-agent 定制。

**交付物**:
- [ ] Skills CRUD UI（查看、创建、编辑、删除）
- [ ] 全局 Skills vs Workspace Skills 分层管理
- [ ] Per-agent Skills 配置（agents.configJson 支持 enabledSkills/disabledSkills）
- [ ] Skill 编辑器（YAML frontmatter + Markdown body）
- [ ] Import/Export skills（与 `.agents/skills/` 目录格式兼容）

**技术决策待定**:
- Agent 是否应该拥有自己的 "workspace" 概念？
- Skills 是否需要版本管理？
- Skills 之间是否需要依赖关系？

---

## L2 — Agent Session 体验增强

**里程碑**: 2026 W20-21 (5/12 - 5/25)

**动机**: 对齐 Linear AIG 设计理念。当前 chat 是平铺流式文本，缺少结构化活动展示。

### L2a — Agent Plans (步骤清单)
- [ ] Plan 数据模型（per-session checklist: content + status）
- [ ] Plan UI 渲染（会话顶部/侧栏显示当前计划）
- [ ] Provider 层支持将 tool-use/plan 事件映射到 Plan steps
- [ ] Plan 实时更新（streaming 中动态添加/完成步骤）

### L2b — 结构化 Activity & Elicitation
- [ ] 消息类型扩展（thought / action / elicitation / response / error）
- [ ] Elicitation 交互 UI（Agent 提问 + 选项卡片 + 用户回复）
- [ ] Stop signal 强化（用户发送 stop → Agent 确认停止）
- [ ] Ephemeral activity 支持（临时状态消息，被下一条覆盖）

---

## L3 — Sandboxed Execution / VFS

**里程碑**: 2026 W22-24 (5/26 - 6/15)

**动机**: Agent 操作文件和执行命令需要安全隔离。用户应能 preview → accept → 落盘。

### L3a — Spike (1 周)
- [ ] 技术路线评估：WASM MemFS vs Git worktree vs CoW tmpfs vs Container
- [ ] PoC 验证选定方案
- [ ] 确定 diff preview UI 交互模式

### L3b — 实现 (2 周)
- [ ] Sandbox 文件系统抽象层
- [ ] Agent session 绑定独立沙盒
- [ ] Diff preview panel（文件变更预览）
- [ ] Accept/Reject/Partial-accept 操作
- [ ] Shell 命令沙盒执行（输出捕获、副作用隔离）

---

## L4 — Multi-Agent 协同

**里程碑**: 2026 W25+ (6/16-)

**前置依赖**: L1 + L2 稳定

**方向**:
- [ ] Agent-to-Agent delegation（子任务委派）
- [ ] Supervisor pattern（编排 Agent）
- [ ] Parallel execution（多 Agent 并行）
- [ ] Human-in-the-loop arbitration（人工裁判）
- [ ] Agent 通信协议（消息格式、上下文传递）

---

## 设计原则 (来自 Linear AIG + 我们自己的思考)

1. **Agent 必须清晰表明身份** — badge、头像、名字区分人和 Agent
2. **Agent 在平台内原生操作** — 使用与人相同的 UI 和操作
3. **即时反馈** — 收到请求后立即响应
4. **透明推理** — 思考过程、工具调用、决策逻辑可追溯
5. **尊重停止请求** — stop 后立即脱离
6. **人承担最终责任** — 明确的委派链，Agent 不能被问责

---

## Open Questions

- Agent 是否需要自己的 workspace？
  - 选项 A: Agent 关联到现有 workspace，skills/context 来自 workspace
  - 选项 B: Agent 有独立 "agent workspace"（配置空间，不是文件系统）
  - 选项 C: Agent 是跨 workspace 的实体，按会话绑定 workspace
  - **当前倾向**: C（已实现 — Agent entity 跨 workspace，session 绑定 workspace）

- Skills 颗粒度？
  - 文件级（一个 SKILL.md 一个 skill）vs 组件级（skill 内含多个 sub-operations）
  - **当前倾向**: 文件级（已实现格式，保持简单）

- VFS 对性能影响？
  - 需要 spike 数据支撑
