<!-- Once this directory changes, update this README.md -->

# E2E/Features

这里存放面向用户行为的 Cucumber feature 文件，描述打包后的 Electron 应用应满足的端到端流程。
Feature 只表达行为，不嵌入具体实现细节，具体自动化绑定在 `e2e/src/steps/`。
新增跨进程能力时，应优先在这里补一个用户视角的回归场景。
优先级标签应尽量放在 scenario 级别，避免 feature 级继承污染 `@P0/@P1/@P2` 的执行范围。

## Files

- **agent-identity.feature**: Agent 身份设置的导航、空状态，以及 Agent 创建 / 列表展示 / Provider→Model 联动 / 编辑 / 删除等可见结果回归
- **agent-runtime-settings.feature**: Provider 设置与运行时 profile 管理，覆盖 OpenAI-compatible / Codex / Claude Agent profile 的 UI 创建、编辑、删除、启停与探测失败状态
- **chat.feature**: 聊天 happy path、多轮上下文在界面中的体现、Session 重命名 / Pin / 删除 / Markdown 导出、Reasoning 展示、Tool Call 渲染、停止生成、provider 错误与刷新恢复
- **git.feature**: Git 真实工作流回归，覆盖通过 UI 添加真实 Git 工作区、经新建聊天进入 chat tab、Header 分支控件、branch picker 创建/切换分支，以及右侧 Git 面板提交图渲染
- **issue-agent-integration.feature**: Issue 委派给 Agent 后的关联会话、完成状态、取消委派，以及已完成会话的 rerun→新聊天会话生成→回到主侧栏后的会话列表刷新
- **keyboard-shortcuts.feature**: 全局 shell / layout / tab 键盘快捷键回归，覆盖 `⌘,`/`Escape`、`⌘B`、聊天标签页中的 `⌘⌥B`/`Ctrl+\``，以及 `⌘T`/`⌘W`/`⌘1`/`Ctrl+Tab` 的真实键盘路径
- **kanban.feature**: 看板、Issue 与评论基础流程，以及 Issue 跨列移动、看板删除、Issue 编辑 / 删除、Status Column 管理与 Issue 搜索的可见结果回归
- **search.feature**: GlobalSearchDialog 真实入口上的线程搜索回归，覆盖标题命中与消息内容命中的高亮展示以及打开对应会话
- **skills.feature**: Skills 真实 UI 回归，覆盖全局 / 工作区 / Agent 三个 scope 的创建、查看、编辑、删除与导入；Agent 私有技能场景必须先通过 Settings UI 创建 Provider→Agent，再进入内嵌 detail/skills 视图验证可见结果
- **tab-management.feature**: Tab 创建、切换与持久化行为
- **usage.feature**: Usage Dashboard 真实入口回归，覆盖无 usage 数据时的空状态，以及真实聊天后的精确汇总与热力图 tooltip
- **user-journeys.feature**: 首次使用旅程回归，覆盖第一次添加工作区、开始聊天、创建第一个看板与第一条 Issue 的核心路径
- **workflow-rules.feature**: Workflow Rules 真实入口回归，覆盖工作区详情页 Workflow 标签中的 All Agents / Agent-scoped 规则保存、scope 切换与重开后的可见结果
- **workspace.feature**: Workspace 空状态、添加、移除、重命名、多工作区切换、详情页 Overview 真实内容，以及从工作区菜单复制代码库到剪贴板的真实路径回归
