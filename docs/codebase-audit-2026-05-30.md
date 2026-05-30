# Cradle 项目完整审计报告

> 审计日期：2026-05-30
> 审计范围：代码耦合度、测试覆盖率、安全性、API/IPC 设计、数据库与状态管理、构建与开发体验

---

## 目录

1. [项目概况](#1-项目概况)
2. [模块耦合度分析](#2-模块耦合度分析)
3. [测试覆盖率审计](#3-测试覆盖率审计)
4. [安全审计](#4-安全审计)
5. [API 与 IPC 设计审计](#5-api-与-ipc-设计审计)
6. [数据库与状态管理审计](#6-数据库与状态管理审计)
7. [构建与开发体验审计](#7-构建与开发体验审计)
8. [综合风险矩阵](#8-综合风险矩阵)
9. [修复建议优先级](#9-修复建议优先级)

---

## 1. 项目概况

Cradle 是一个 **AI Agent 管理平台**，桌面端优先，用于运行 Agent、追踪 Issue、管理 Session、集成多 LLM 提供商。采用 AGPLv3 协议。

**技术栈概览：**

| 层 | 技术 |
|---|---|
| 桌面端 | Electron + electron-vite + Velopack |
| 前端 | React 19 + TanStack Router + Zustand + Tailwind v4 |
| 后端 | Hono + Elysia + tsyringe DI + Drizzle/SQLite |
| 构建 | Vite 8, pnpm 11 workspaces, TypeScript 5.9 |
| 测试 | Vitest + Playwright + Cucumber |

**Monorepo 结构：**

```
apps/
  desktop/       # Electron 桌面客户端
  web/           # React SPA 前端（28 个 feature 模块）
  server/        # Bun/Node 后端（32 个业务模块）
  zhi-slack-bridge/  # Slack 桥接
  playground/    # 开发 playground
packages/
  db/            # Drizzle ORM schema + 迁移
  ipc/           # 类型安全 Electron IPC
  cli/           # CLI 工具
  plugin-sdk/    # 插件 API
  tabs-next/     # Tab 导航运行时
  streamdown/    # 流式 Markdown 渲染
plugins/
  browser-use/   # 浏览器控制 MCP
  cc-switch/     # Provider 映射
  system-info/   # 系统信息
```

---

## 2. 模块耦合度分析

### 2.1 Server 端（32 个模块）

#### 依赖关系图

```
chat-runtime     -> chronicle, model-registry, observability, provider-targets, providers, secrets, skills, usage
session          -> issue, provider-targets, providers, workspace
providers        -> model-registry, provider-targets, secrets
issue-agent      -> chat-runtime, issue, session, workflow-rules
chronicle        -> chat-runtime, profiles, secrets
agent-identity   -> external-provider-sources, provider-targets
automation       -> chat-runtime, session
desktop          -> chat-runtime, chronicle
profiles         -> provider-targets, providers
provider-targets -> providers
model-registry   -> providers
external-provider-sources -> secrets
external-work-import -> preferences, workspace
pty              -> session
search           -> session
git              -> workspace
pack-codebase    -> workspace
session-await    -> chat-runtime
test-reset       -> chat-runtime
```

**零外部依赖的叶子模块（13 个）：** `acp`, `filesystem`, `health`, `issue`, `kanban`, `observability`, `preferences`, `secrets`, `server-events`, `skills`, `usage`, `workflow-rules`, `workspace`

#### 最常被依赖的模块（核心模块）

| 排名 | 模块 | 被依赖次数 | 依赖者 |
|---|---|---|---|
| 1 | `providers` | 5 | chat-runtime, model-registry, profiles, provider-targets, session |
| 2 | `provider-targets` | 5 | agent-identity, chat-runtime, profiles, providers, session |
| 3 | `chat-runtime` | 6 | automation, chronicle, desktop, issue-agent, session-await, test-reset |
| 4 | `session` | 4 | automation, issue-agent, pty, search |
| 5 | `secrets` | 4 | chat-runtime, chronicle, external-provider-sources, providers |

#### 依赖最多的模块（God Module 候选）

| 排名 | 模块 | 外部依赖数 | 依赖列表 |
|---|---|---|---|
| 1 | **chat-runtime** | 8-11 | chronicle, model-registry, observability, provider-targets, providers, secrets, skills, usage |
| 2 | issue-agent | 4 | chat-runtime, issue, session, workflow-rules |
| 3 | session | 4 | issue, provider-targets, providers, workspace |
| 4 | providers | 3 | model-registry, provider-targets, secrets |
| 5 | chronicle | 3 | chat-runtime, profiles, secrets |

#### 循环依赖（3 组）

| 循环对 | 详情 |
|---|---|
| `providers` <-> `provider-targets` | providers/service.ts 导入 resolveProviderTarget；provider-targets/service.ts 导入 runtimeSupportsProviderKind |
| `providers` <-> `model-registry` | providers/service.ts 导入 ModelRegistry；model-registry/service.ts 导入 lookupModelRawExact |
| `chat-runtime` <-> `chronicle` | chat-runtime 导入 buildAgentMemoryContext；chronicle 深入 chat-runtime/engine/providers 内部 |

#### 紧耦合集群

**Provider 三角：** `providers`、`provider-targets`、`model-registry` 三者互相引用，无法独立开发/测试/部署。

**Runtime Hub：** `chat-runtime` 为中心的星型拓扑，拉入 8+ 个模块。chronicle 直接深入 chat-runtime 内部 engine 目录，违反封装。

#### DI 使用评估

**未使用任何 DI 框架。** 无 tsyringe、InversifyJS 或 DI 容器。所有模块通过静态 import 硬编码。模块边界仅靠 `../module-name/service` 约定维持。

---

### 2.2 Web 端（28 个 feature）

#### 跨 feature 依赖统计

- **55 条** 唯一跨 feature 依赖边
- **~132 条** 跨 feature import 语句
- 18 个 feature 有跨 feature import，10 个完全自包含

#### 最常被依赖的 feature（核心）

| 排名 | Feature | Import 行数 | 被依赖者数 | 导出内容 |
|---|---|---|---|---|
| 1 | **agent-runtime** | 39 | 8 | use-agents, use-agent-models, use-provider-targets 等 |
| 2 | **workspace** | 26 | 9 | use-workspace, use-workspace-files, use-session |
| 3 | composer-toolbar | 15 | 6 | provider-model-picker, provider-model-menu 等 |
| 4 | chat | 14 | 4 | Composer, use-chat-session, message-bubble 等 |
| 5 | system-agent | 12 | 3 | context-registry, context-items 等 |

#### 依赖最多的 feature（God Feature 候选）

| 排名 | Feature | 外部依赖数 | 依赖列表 |
|---|---|---|---|
| 1 | **workspace** | **8** | agent-management, filesystem, git, kanban, pack-codebase, plugins, search, settings |
| 2 | **settings** | **7** | agent-management, agent-runtime, chronicle, composer-toolbar, skills, system-agent, workspace |
| 3 | chat | 5 | agent-runtime, composer-toolbar, settings, system-agent, workspace |
| 4 | agent-management | 4 | agent-runtime, composer-toolbar, settings, skills |
| 4 | kanban | 4 | agent-runtime, settings, system-agent, workspace |

#### 循环依赖（8 组）

| 循环对 | 核心问题 |
|---|---|
| `agent-management` <-> `composer-toolbar` | provider-icons 放错位置 |
| `agent-management` <-> `settings` | settings-overlay-store 全局共享 |
| `chat` <-> `system-agent` | 消息 UI 与 AI 上下文系统互相耦合 |
| `chronicle` <-> `settings` | overlay store 问题 |
| `git` <-> `workspace` | 双向引用 |
| `kanban` <-> `workspace` | 双向引用 |
| `search` <-> `workspace` | 双向引用 |
| `settings` <-> `workspace` | 双向引用（最大循环对） |

#### Zustand Store 全局共享热点

| Store | 所在 Feature | 跨 Feature 消费者数 |
|---|---|---|
| `useSettingsOverlayStore` | settings | **9 个 feature** |
| `useGlobalSearchStore` | search | 2 个 feature |

#### 隐藏耦合热点模块

| Import 次数 | 模块 | 被谁导入 |
|---|---|---|
| 14 | `workspace/use-workspace` | kanban(12), home, search, settings, new-chat |
| 10 | `agent-runtime/use-agents` | agent-management(3), kanban(2), composer-toolbar, chronicle, settings, workspace-detail, chat |
| 8 | `settings/settings-overlay-store` | agent-management, chronicle, desktop-tray, kanban, new-chat, search, workspace |
| 8 | `agent-runtime/use-agent-models` | agent-management(3), composer-toolbar, chronicle, settings, chat, workspace-detail |

---

### 2.3 耦合度总结

| 维度 | Server | Web |
|---|---|---|
| 模块总数 | 32 | 28 |
| 循环依赖 | 3 组 | 8 组 |
| God Module | chat-runtime (8-11 deps) | workspace (8 deps) |
| 叶子模块占比 | 13/32 (41%) | 10/28 (36%) |
| 边界强制机制 | 无（仅靠约定） | 无（仅靠约定） |

---

## 3. 测试覆盖率审计

### 3.1 测试文件统计

| App/Package | 测试文件数 |
|---|---|
| `apps/server` | 60（46 在 tests/，14 共置在 src/） |
| `apps/web` | 54 |
| `apps/desktop` | 11 |
| `packages/db` | 1 |
| `packages/ipc` | 1 |
| `packages/cli` | 2 |
| `packages/plugin-sdk` | **0** |
| `packages/tabs-next` | 8 |
| `packages/streamdown` | 3 |
| **总计** | **140** |

### 3.2 Server 模块覆盖率

32 个模块中 26 个有测试（81%）。**6 个模块无测试：**
- `agent-identity`
- `filesystem`
- `model-registry`
- `provider-targets`
- `secrets`
- `server-events`

17 个插件中 8 个有测试（47%）。**9 个插件无测试：** discovery, event-bus, external-provider-source-registry, hooks, install-receipt, mcp-registry, skill-registry, static-server, validation

### 3.3 各区域覆盖率

| 区域 | 模块数 | 有测试 | 覆盖率 |
|---|---|---|---|
| `apps/server`（模块） | 32 | 26 | **81%** |
| `apps/server`（插件） | 17 | 8 | 47% |
| `apps/web`（features） | 28 | ~16 | ~57% |
| `apps/desktop` | 20 | 8 | 40% |
| `packages/db` | 3 | 1 | ~33% |
| `packages/plugin-sdk` | 7 | 0 | **0%** |
| `packages/ipc` | 多文件 | 1 | 低 |
| `packages/cli` | 多文件 | 2 | 低 |
| `packages/tabs-next` | 多文件 | 8 | 良好 |
| `packages/streamdown` | 多文件 | 3 | 中等 |

### 3.4 E2E 测试

Cucumber 框架，22 个 `.feature` 文件，覆盖：agent identity, chat, git, kanban, plugins, settings, terminal, search, workspace, skills 等。

### 3.5 关键发现

- `apps/desktop` **无 test 脚本**（package.json 中无 test 命令）
- `packages/plugin-sdk` **零测试覆盖**
- 整体约 **50-55%** 的模块/feature 有测试文件
- 无测试覆盖率报告工具（无 istanbul/c8 配置）

---

## 4. 安全审计

### 4.1 密钥泄露（严重）

| 问题 | 严重性 | 详情 |
|---|---|---|
| `apps/server/.env` 被 git 追踪 | **严重** | 包含 `CRADLE_CREDENTIAL_SECRET=change-me-server-secret`，需从 git 移除并加入 .gitignore |
| `apps/zhi-slack-bridge/.env` 存在真实 token | **中等** | 包含 SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET，需确认从未被提交 |

### 4.2 依赖安全

- 无 `*` 或 `latest` 版本范围，全部使用 `^` 范围
- 无明显已废弃依赖
- **无自动化 `pnpm audit` 在 CI 中运行**

### 4.3 .gitignore 覆盖

覆盖 `node_modules`, `dist`, `.env`, `.env.local`, `data` 等。**缺口：** `apps/server/.env` 未被覆盖（仅根目录 `.env` 被 gitignore）。

### 4.4 输入验证

Zod schema 在 30+ 文件中使用，覆盖 API 路由、provider 配置、preferences 等。**覆盖良好。**

### 4.5 CORS 配置

`apps/server/src/app.ts` 限制 CORS 仅允许 `localhost`, `127.0.0.1`, `::1`。**适合本地优先应用。**

### 4.6 SQL 注入

全程使用 Drizzle ORM。唯一 raw SQL 为静态列引用 `sql\`messages.rowid\``，无用户输入。**安全。**

### 4.7 XSS 风险

7 处 `dangerouslySetInnerHTML` 使用：
- `packages/streamdown/src/blocks/code-block.tsx` — Shiki 高亮输出（可信）
- `apps/web/src/components/ui/chart.tsx` — 图表样式注入（**需审查**）
- `apps/web/src/features/workspace/workspace-file-preview.tsx` — HTML 文件预览（**需审查**）

---

## 5. API 与 IPC 设计审计

### 5.1 Server API

| 维度 | 状态 | 详情 |
|---|---|---|
| 框架 | Elysia (Bun-native) | 链式 .get()/.post()/.ws() 定义路由 |
| OpenAPI | ✅ 有 | `/openapi.json` + Scalar 文档 UI `/docs` |
| 验证 | TypeBox + Zod | TypeBox 为主要服务端验证器 |
| 错误处理 | ✅ 全局 | `createErrorMappingPlugin()` 统一处理 AppError |
| 认证 | ❌ 无 | 无任何认证/授权中间件 |
| 版本控制 | ❌ 无 | 无 `/v1` 前缀，OpenAPI 硬编码 `0.0.1` |

**高危发现：** `test-reset` 模块（`POST /test/reset`）可清空整个数据库并删除用户文件，无任何防护。

### 5.2 IPC 层

| 维度 | 状态 | 详情 |
|---|---|---|
| 模式 | 装饰器 | `@IpcMethod()` 标记方法，自动注册 `ipcMain.handle()` |
| 类型安全 | ✅ 完整 | `createIpcProxy<T>()` 提供编译时类型推断 |
| 可观测性 | ✅ 有 | OpenTelemetry span + IPC devtool observer |
| 安全 | ⚠️ 无白名单 | 任何 renderer 可调用任何已注册 channel |

### 5.3 Web <-> Server 通信

- **生成客户端：** `@hey-api/openapi-ts` 自动生成类型安全客户端
- **手动客户端：** automation feature 使用手写 fetch + Zod 验证
- **SSE：** 用于 chat 流式传输，有完整 retry/backoff 逻辑
- **WebSocket：** PTY 终端使用，Zod discriminatedUnion 验证消息

### 5.4 Plugin SDK

| 维度 | 状态 | 详情 |
|---|---|---|
| API 暴露 | 丰富 | 路由注册、MCP、技能、provider、生命周期钩子、事件总线、KV 存储 |
| 权限系统 | ✅ 有 | manifest 声明 + `evaluatePluginPermissionPolicy()` |
| 高危能力 | ⚠️ | Desktop 插件可使用 CDP 完全控制浏览器；Server 插件可拦截 agent 查询 |
| 信任模型 | ⚠️ | 内置插件默认信任，仅 `externalLocal` 来源的插件有权限检查 |

---

## 6. 数据库与状态管理审计

### 6.1 数据库（packages/db）

| 维度 | 状态 | 详情 |
|---|---|---|
| 表数量 | 53 个 | 跨 17 个 schema 模块 |
| 索引 | ✅ 完善 | FK 列均有索引，复合索引覆盖常见查询模式 |
| 外键级联 | ✅ 规范 | 父子关系用 cascade，引用关系用 restrict/set null |
| N+1 问题 | ✅ 无明显 | 仅 client 端有批量 PATCH 可优化为服务端 batch |
| 迁移 | Drizzle Kit | 53 个迁移 SQL 文件 |
| 种子数据 | ❌ 无 | 无 seed/fixture 系统 |

**核心域表分布：** chat（sessions, messages, usage）、issue（statuses, milestones, issues, comments）、automation（definitions, runs, artifacts）、chronicle（22 表）、identity（agents, profiles, credentials）

### 6.2 状态管理（apps/web）

**Zustand Stores（7 个）：**

| Store | 用途 | 大小 |
|---|---|---|
| `useChatStore` | 消息、流式状态、工具实体 | ~1096 行（最大） |
| `usePluginStore` | 插件面板/命令注册 | 正常 |
| `useJarvisUiStore` | AI Agent UI 状态 | 正常，跨窗口 BroadcastChannel 同步 |
| `useSettingsOverlayStore` | 设置覆盖层开关 | 简单，但被 9 个 feature 消费 |
| `useGlobalSearchStore` | 命令面板状态 | 简单 |
| `useTerminalPanelStore` | 终端会话 | 简单 |
| `useTabsDebugStore` | Tab 调试状态 | 简单 |

**React Query 模式：** 四级刷新策略（static 5min / background 60s / active 10s / interactive 3s），query key 层级化结构良好。

**Zustand/React Query 分工明确：** Zustand 管 UI 状态和流式数据，React Query 管服务端 CRUD 数据，无重叠。

### 6.3 数据流

- **REST API** 用于 CRUD（自动生成 OpenAPI 客户端）
- **SSE** 用于 chat 流式传输（含 retry/backoff）
- **乐观更新：** 仅 4 处使用 `setQueryData`，大部分用 `onSuccess` 失效策略
- **跨 Tab 同步：** `BroadcastChannel` 处理 jarvis-ui-store 的持久化状态

---

## 7. 构建与开发体验审计

### 7.1 构建系统

| 维度 | 状态 | 详情 |
|---|---|---|
| 打包工具 | Vite 8（统一） | Web/Server/Desktop/Plugins 全部使用 |
| 代码分割 | ✅ 良好 | manualChunks 分离 React、TanStack、TipTap、xterm 等 vendor |
| Tree-shaking | ✅ 配置 | target: esnext, modulePreload.polyfill: false |
| React Compiler | ✅ 启用 | babel-plugin-react-compiler |
| 死代码检测 | Knip | 覆盖 8 个工作区 |

### 7.2 TypeScript 配置

| 设置 | 状态 |
|---|---|
| `strict: true` | ✅ 全部启用 |
| `noImplicitAny: false` | ⚠️ web, server, tsconfig.node.json 中关闭，削弱 strict 效果 |
| `skipLibCheck: true` | ✅ 标准 monorepo 做法 |

### 7.3 Linting & Formatting

| 维度 | 状态 | 详情 |
|---|---|---|
| ESLint | 9 flat config | eslint-config-hyoban |
| Prettier | 单引号、无分号、100 字符宽 | 标准配置 |
| 禁用规则 | ⚠️ | `react-hooks/rules-of-hooks` 被禁用（风险） |
| CLI 包 | ⚠️ | `packages/cli` 完全排除 lint |

### 7.4 CI/CD

| 维度 | 状态 | 详情 |
|---|---|---|
| 工作流 | 仅 1 个 | `release-desktop-velopack.yml`（桌面发布） |
| 质量门禁 | ❌ 无 | 无 lint/typecheck/test 的 CI 流程 |
| 权限 | ✅ 范围化 | `permissions: contents: write` |
| Action 版本 | ✅ 固定 | 使用 `@v4` |

### 7.5 开发者体验

| 维度 | 状态 |
|---|---|
| 贡献指南 | ❌ 无 |
| 全栈开发脚本 | ✅ `pnpm dev:fullstack`（concurrently） |
| HMR | ✅ Vite dev server + React Fast Refresh |
| i18n 工作流 | ✅ 完善（diff, check, unused 分析） |
| 类型检查 | 4 部分复合（node, server, web, desktop） |

---

## 8. 综合风险矩阵

### 8.1 高风险项（需立即处理）

| # | 问题 | 影响范围 | 类别 |
|---|---|---|---|
| 1 | `apps/server/.env` 被 git 追踪含密钥 | 安全 | 密钥泄露 |
| 2 | `test-reset` 模块无认证可清空数据库 | 安全 | 未授权访问 |
| 3 | 无 CI 质量门禁 | 工程化 | 代码质量无保障 |
| 4 | `noImplicitAny: false` 削弱 strict 模式 | 类型安全 | 类型安全漏洞 |

### 8.2 中风险项（计划处理）

| # | 问题 | 影响范围 | 类别 |
|---|---|---|---|
| 5 | Server 3 组循环依赖（Provider 三角） | 架构 | 可维护性 |
| 6 | Web 8 组循环依赖 | 架构 | 可维护性 |
| 7 | `chat-runtime` God Module（8-11 deps, 11K 行） | 架构 | 可维护性 |
| 8 | `workspace` God Feature（8 deps, 9 importers） | 架构 | 可维护性 |
| 9 | `useSettingsOverlayStore` 被 9 个 feature 消费 | 架构 | 隐藏耦合 |
| 10 | `react-hooks/rules-of-hooks` 被禁用 | 代码质量 | 正确性风险 |
| 11 | `packages/plugin-sdk` 零测试覆盖 | 测试 | 质量保障 |
| 12 | 无 API 认证/授权机制 | 安全 | 未授权访问 |
| 13 | `dangerouslySetInnerHTML` 在 chart/file-preview 中 | 安全 | XSS 风险 |
| 14 | `packages/cli` 排除所有 lint | 代码质量 | 一致性 |

### 8.3 低风险项（可延后）

| # | 问题 | 影响范围 | 类别 |
|---|---|---|---|
| 15 | `apps/desktop` 无 test 脚本 | 测试 | 覆盖率 |
| 16 | 无 seed/fixture 系统 | 开发体验 | 效率 |
| 17 | 无贡献指南 | 文档 | 新人上手 |
| 18 | 无测试覆盖率报告工具 | 测试 | 度量 |
| 19 | 无 API 版本控制 | API 设计 | 前向兼容 |

---

## 9. 修复建议优先级

### P0 — 立即修复

| 建议 | 预期收益 |
|---|---|
| 将 `apps/server/.env` 从 git 追踪中移除，加入 .gitignore | 消除密钥泄露风险 |
| 给 `test-reset` 模块添加认证/环境检查 | 防止生产环境数据丢失 |
| 添加 CI 质量门禁（lint + typecheck + test） | 防止 main 分支代码退化 |
| 将 `noImplicitAny` 改为 `true` | 恢复 strict 模式完整效果 |

### P1 — 短期修复（1-2 周）

| 建议 | 预期收益 |
|---|---|
| 提取 `providers/types.ts`、`provider-base.ts` 为共享模块 | 打破 Provider 三角循环依赖 |
| 将 `settings-overlay-store` 移到 `app/stores` 或 shell 层 | 消除 9 个 feature 的隐藏耦合 |
| 启用 `react-hooks/rules-of-hooks` 规则 | 恢复 hooks 正确性检查 |
| 审查 `dangerouslySetInnerHTML` 用户输入路径 | 消除 XSS 风险 |
| 为 `packages/plugin-sdk` 添加基础测试 | 覆盖关键 API |

### P2 — 中期改进（1-2 月）

| 建议 | 预期收益 |
|---|---|
| 将 `chat-runtime/engine/` 和 `chat-runtime/providers/` 提升为顶层模块 | 降低 God Module 复杂度 |
| 将 `provider-icons` 从 agent-management 提到 shared UI | 打破 agent-management <-> composer-toolbar 循环 |
| 拆分 `workspace` feature（use-workspace, use-session, use-workspace-files） | 降低 God Feature 耦合 |
| 添加 import 守卫（eslint-plugin-import 或 barrel export） | 防止边界退化 |
| 添加 `pnpm audit` 到 CI | 自动化依赖安全检查 |
| 为 API 添加认证中间件 | 防止未授权访问 |

### P3 — 长期优化

| 建议 | 预期收益 |
|---|---|
| 引入 DI 框架或 import 守卫强制模块边界 | 架构可维护性 |
| 添加测试覆盖率报告（c8/istanbul） | 度量和改进测试质量 |
| 添加 API 版本控制 | 前向兼容 |
| 建立 seed/fixture 系统 | 开发效率 |
| 编写贡献指南 | 新人上手效率 |

---

## 附录：审计方法论

- **耦合度分析：** 通过 grep 和 glob 追踪跨模块 import 路径，构建依赖图
- **测试覆盖率：** 统计各 app/package 的测试文件数量，对比模块/feature 总数
- **安全审计：** 检查 .env 追踪、dangerouslySetInnerHTML、CORS、SQL 注入、依赖版本
- **API/IPC 审计：** 审查路由定义、验证机制、认证、错误处理、IPC channel 安全
- **数据库审计：** 审查 schema 定义、索引、外键级联、N+1 模式
- **DX 审计：** 审查构建配置、TS strict 设置、ESLint 规则、CI 流程
