# Product Telemetry

## 目标

Cradle 需要把 local observability、release crash reporting 和 product analytics 明确分开。外部 telemetry 必须有 consent、redaction 和 disable semantics，不能和本地 diagnostics 混为一谈。

## Alma 证据

Alma 包含 Sentry Electron release metadata 和 renderer PostHog provider signals。Settings 中也有 analytics-related UI signals。

## Cradle 当前状态

Cradle 有 local observability events/incidents、server logs、Langfuse tracing 和 devtools。当前没有发现 Electron crash reporting 或 product analytics opt-in/out surface。

## Owner / Namespace

`apps/desktop` 拥有 crash reporting integration。`apps/web` 拥有 product analytics capture points。`preferences` 拥有 consent state。`observability` 继续拥有本地 diagnostics，不向外部 telemetry owner 写入数据。

## 目标行为

- Telemetry 默认遵守产品隐私策略，且用户可以查看和修改 consent。
- Crash reports 必须 redact paths、prompts、secrets 和 message content，除非用户明确允许。
- Local observability 在 telemetry disabled 时仍然可用。
- Release channel、app version 和 platform metadata 可以发送，但不得包含 workspace content。

## API / IPC 草案

- `GET /preferences/telemetry`
- `PUT /preferences/telemetry`
- `desktop.telemetry.captureCrash(metadata)`

## 数据模型

Persist consent state、last changed time、policy version、allowed event classes 和 redaction mode。Cradle DB 不默认保存 raw analytics events，除非它们属于本地 diagnostics。

## 验收

- 禁用 telemetry 后立即停止 external event emission。
- Crash reporting redaction 覆盖 paths、prompts、secrets 和 message content。
- Telemetry off 时 local devtool observability 仍能记录和导出 local events。
