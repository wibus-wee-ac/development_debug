# 20260513-01: src/shared 清理 + 全栈可观测性增强

- **Status**: Done
- **Created**: 2026-05-13

## Problem

1. `src/shared/` 是 IPC 架构残留。5 个文件中 2 个是死代码，剩余 3 个只有 `apps/web` 使用，不应留在顶层。
2. 后端几乎无可观测性：Logger 类没人用，全靠 `console.*`，无结构化日志、无 request timing、无内存监控。
3. 前端内存泄漏频繁但无监控手段。
4. DevTools 页面 (`/devtool`) 4 个 panel 全依赖已删除的 `window.ipcDevtool`，完全不可用。
5. Health 端点只返回 `{status: "ok"}`，不报告系统资源状态。

## Solution Overview

分 4 个独立工作节点：

- **Node A**: 清理 `src/shared`（删死代码 + 搬迁到 apps/web）
- **Node B**: 后端可观测性（pino 结构化日志 + request timing + health 增强）
- **Node C**: 前端内存监控（performance.memory 采集 + 泄漏检测 + web-vitals）
- **Node D**: DevTools 重建（从 window.ipcDevtool 迁移到 HTTP API + 内存 buffer）

Node A、B、C 无依赖可并行。Node D 依赖 B 和 C。

## Node A: src/shared 清理

### 目标
- 删除死代码：`chat-preferences.ts`, `timeline-projection.ts`
- 搬迁 `approval-events.ts`, `chat-events.ts`, `push-events.ts` 到 `apps/web/src/lib/contracts/`
- 移除 `push-events.ts` 对 `@cradle/ipc` 的 `ObservabilityIncident` 类型依赖（内联定义或从 server OpenAPI 获取）
- 删除 `src/shared/` 目录
- 移除 `apps/web/tsconfig.json` 中的 `@shared` alias
- 更新所有 import 路径

### 验收标准
- `src/shared/` 目录不存在
- `apps/web` typecheck + build 通过
- 无 `@shared` import 残留

### 涉及文件
- `src/shared/*` — 删除
- `apps/web/tsconfig.json` — 移除 `@shared` path alias
- `apps/web/src/features/approval/approval-card.tsx` — 更新 import
- `apps/web/src/features/approval/use-approval.ts` — 更新 import
- `apps/web/src/features/approval/sse-approval-connector.ts` — 更新 import
- `apps/web/src/lib/types.ts` — 更新 import
- `apps/web/src/lib/signal.ts` — 更新 import
- `apps/web/src/features/chat/use-chat-events.ts` — 更新 import

## Node B: 后端可观测性

### 目标
1. 引入 **pino** 作为结构化日志库
2. 创建 ElysiaJS 日志中间件：自动记录请求/响应、耗时、关联 request-id
3. 替换散落的 `console.*` 为 pino logger 调用
4. 增强 `/health` 端点：返回内存用量 (`process.memoryUsage()`)、DB 状态、uptime、活跃连接信息
5. 添加 request timing 到 observability event（慢请求 >3s 自动记录）

### 验收标准
- `pnpm test && pnpm typecheck && pnpm build` 在 `apps/server` 通过
- `/health` 返回 `{ status, memory: { heapUsed, heapTotal, rss, external }, uptime, db: "ok"|"error" }`
- 每个 HTTP 请求产生一条结构化 JSON 日志（含 method、path、status、duration、requestId）
- 现有 `console.error`/`console.warn` 调用替换为 pino（至少 server 核心路径）

### 涉及文件
- `apps/server/package.json` — 添加 `pino` 依赖
- `apps/server/src/logging/logger.ts` — 重写为 pino wrapper
- `apps/server/src/http/request-id.ts` — 扩展，传播 requestId 到 logger context
- `apps/server/src/http/request-logger.ts` — 新建，ElysiaJS 请求日志中间件
- `apps/server/src/app.ts` — 注册日志中间件
- `apps/server/src/modules/health/index.ts` — 增强返回值
- `apps/server/src/infra.ts` — 更新 logger 初始化

## Node C: 前端内存监控

### 目标
1. 创建 `apps/web/src/lib/perf-monitor.ts`：
   - 定时采集 `performance.memory`（30s 间隔）
   - 环形缓冲存最近 200 个采样点
   - 简单泄漏检测：连续 10 次采样 heapUsed 持续增长 → console.warn
2. 集成 **web-vitals**：收集 LCP/FID/CLS/INP/TTFB
3. 在应用启动时初始化监控
4. 暴露 `getPerfSnapshots()` 和 `getWebVitals()` 供 DevTools 使用

### 验收标准
- `apps/web` typecheck + build 通过
- `web-vitals` 已安装并集成
- `perf-monitor.ts` 模块可正常采集数据
- 暴露的 API 可在浏览器 console 调用验证

### 涉及文件
- `apps/web/package.json` — 添加 `web-vitals` 依赖
- `apps/web/src/lib/perf-monitor.ts` — 新建
- `apps/web/src/main.tsx` 或入口文件 — 初始化监控

## Node D: DevTools 重建

### 目标
将 `/devtool` 页面从依赖 `window.ipcDevtool`（已删除）改为：
1. **Server Observability** panel — 从 HTTP API `/observability/events` 拉取数据
2. **Server Health** panel — 从增强的 `/health` 定时拉取系统状态
3. **Memory** panel — 从前端 `perf-monitor.ts` 读取内存趋势
4. 删除旧的 IPC/ACP/Agent-Context panel（全部依赖已删 API）

### 依赖
- Node B（Health 增强后才有数据）
- Node C（perf-monitor 模块就绪后才有数据）

### 验收标准
- `/devtool` 页面不引用 `window.ipcDevtool`
- 3 个新 panel 可正常渲染（即使后端未运行也不崩溃）
- `apps/web` typecheck + build 通过

### 涉及文件
- `apps/web/src/features/devtool/` — 重建
- 删除 `ipc/`, `acp/`, `agent-context/` 子目录
- 保留或重建 `observability/`（改用 HTTP API）
- 新建 `health/` 和 `memory/` 子目录

## Execution Plan

```
      ┌─── Node A (shared cleanup) ───┐
      │                                │
Start ├─── Node B (backend obs)    ────┤─── Node D (devtools rebuild) ─── Done
      │                                │
      └─── Node C (frontend perf)  ───┘
```

A、B、C 并行 → D 串行。
