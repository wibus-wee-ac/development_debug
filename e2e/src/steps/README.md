<!-- Once this directory changes, update this README.md -->

# E2E/Steps

这里的 step definitions 把 feature 文本绑定到 Playwright 驱动的 Electron 自动化。
步骤应优先复用、聚焦可观察行为，并只在必要时通过测试专用 IPC 建立前置状态。
当 feature 语义调整时，应优先修改这里，而不是把业务细节塞回 feature 文本。
除非场景明确就是合约测试，否则不要在这里新增数据库、请求 payload、事件序列等内部实现断言。

## Files

- **agent-identity.steps.ts**: Agent 设置导航、Provider 前置准备、创建 / 列表展示 / Provider→Model 联动 / 编辑 / 删除交互，以及 Thinking Effort 的可见状态断言
- **agent-runtime-settings.steps.ts**: Provider 设置导航、OpenAI-compatible / Codex / Claude Agent profile 创建 / 编辑 / 删除 / 启停 / 探测失败断言，聚焦可见列表和状态变化
- **chat.steps.ts**: 模拟 LLM 的聊天端到端步骤，覆盖多轮上下文在界面中的体现、Session 重命名 / Pin / 删除 / Markdown 导出、Reasoning 展示、Tool Call 渲染、成功、停止、错误与刷新恢复
- **git.steps.ts**: Git 端到端步骤，负责准备真实临时仓库、通过原生目录选择器添加工作区、驱动 Header branch picker 创建/切换分支，并断言右侧 Git 面板与提交图的真实渲染
- **issue-agent-integration.steps.ts**: Issue 委派给 Agent、关联会话状态、取消委派与 rerun 步骤；覆盖从 Issue detail 打开关联 chat 后主侧栏会话列表可见性的真实断言
- **keyboard-shortcuts.steps.ts**: 全局 shell / layout / tab 快捷键步骤，通过真实键盘输入驱动 `⌘,`、`Escape`、`⌘B`、`⌘⌥B`、`Ctrl+\``、`⌘T`、`⌘W`、`⌘1`与`Ctrl+Tab`，并用最小布局状态锚点断言 sidebar / aside / panel / active tab 变化
- **kanban.steps.ts**: 看板、Issue 与评论步骤，覆盖跨列移动、看板删除、Issue 编辑 / 删除、Status Column 增删改排序与 Issue 搜索的可见结果；仅保留最小化数据库读取辅助测试前置状态
- **search.steps.ts**: 全局搜索真实入口步骤，复用聊天别名与可见 chat view 断言，覆盖线程标题高亮、消息片段高亮与打开对应会话
- **skills.steps.ts**: Skills 真实 UI 步骤，覆盖全局 / 工作区 / Agent 三个 scope 的创建、查看、编辑、删除与导入；Agent 前置改为通过 Settings UI 创建 Provider→Agent，不再用文件落盘作为主要验收目标
- **tab-management.steps.ts**: Tab 交互与相关 shell 行为步骤，先确保最小标签数量成立；内容保留断言基于激活 tab 对应的 content 容器，而不是依赖 React Activity 冻结 DOM 下不稳定的通用可见性属性
- **usage.steps.ts**: Usage Dashboard 真实入口步骤，复用聊天/工作区前置流，验证 Dashboard 的可见汇总值、空状态与热力图 tooltip
- **workflow-rules.steps.ts**: Workflow Rules UI 步骤，覆盖真实 Settings 中的 Provider / Agent 创建、工作区详情页 Workflow 标签编辑、scope 切换与关闭后重开；文件系统持久化改由 main 层单测兜底
- **workspace.steps.ts**: Workspace 添加 / 移除 / 重命名 / 多工作区切换 / 复制代码库步骤，聚焦列表、详情页、真实内容、Pack Codebase 成功状态与剪贴板结果
