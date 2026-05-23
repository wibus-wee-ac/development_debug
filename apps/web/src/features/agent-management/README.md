<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Agent Management 负责 Provider 与 Agent Identity 的统一设置界面。
Provider 配置决定模型与运行时来源，Agent Identity 决定 persona、system prompt 与专属 Skills 工作区。
Agent 专属 Skills 基于文件系统表达，存储在 `~/.cradle/agents/{agentId}/skills/`。

## Files

- **agent-detail.tsx**: Agent 详情页，提供内联编辑 identity、provider/model/thinking 统一选择器、system prompt、Claude Agent SDK haiku / sonnet / opus alias、CLI TUI env 输入反馈与 agent-private Skills 管理；alias 清空后直接映射主模型并打开当前 profile 的模型列表，并确保 provider 切换时默认模型与 thinking 能力会同步到 state
- **agent-detail.test.ts**: Agent detail 的纯函数契约测试，覆盖 CLI TUI env 解析反馈、Claude Agent SDK alias config 序列化与创建按钮禁用原因
- **agent-list.tsx**: Agent 列表，显示所有 Agent 卡片；点击行导航到 agent-detail；列表行现在展示绑定的 provider 名称，避免多个同类 provider 时无法分辨归属；draft row 使用即时布局挂载，避免列表高度动画；Settings Agents 首屏在 agents 与 profiles 两条 server-backed query 成功后记录 performance gate
- **agent-runtime-settings.tsx**: 统一 Agent Profile 管理界面；Provider 列表由 TanStack Query owner 驱动，壳层只保留选中/草稿/过滤 UI 状态，并支持编辑 / 删除 / 启停；external provider source profile 使用固定 badge，不接受 plugin UI contribution；draft provider row 使用即时布局挂载，避免列表高度动画；Settings Providers 首屏在 profiles 与 external provider records 两条 server-backed query 成功后记录 performance gate
- **avatar-url.ts**: 统一生成 Agent DiceBear avatar URL，避免列表与详情页重复编码规则
- **custom-models-editor.tsx**: Provider 自定义模型编辑器，支持手动添加模型、models.dev 匹配补全与可访问的模型操作按钮
- **custom-models-editor.test.tsx**: Custom models editor 的交互回归测试，覆盖 icon-only action label 与手动模型添加 fallback
- **index.ts**: Agent Management 功能模块的 barrel export
- **models-panel.tsx**: Provider 模型可见性面板，复用 Agent Runtime 的模型可见性语义，显示 models.dev exact / fuzzy / manual / unmatched 状态，并支持按 Available Model 行保存 registry 映射或手工 registry 条目；空列表表示没有本地缓存，用户可显式点击 Fetch Models 刷新 provider inventory
- **profile-detail-panel.tsx**: Provider 详情面板，继续以 RHF 作为表单 owner，并把模型缓存读取 / 手动 inventory refresh / registry 映射 / 健康检查 / 自动保存 / 删除确认等瞬时 UI 状态收口到局部 reducer，避免细碎 `useState` 级联；external provider source profile 显示固定 Source 区块并禁用 source-owned 编辑，但继续显示 Cradle-owned Available Models、custom models 与 models.dev/cost mapping 设置
