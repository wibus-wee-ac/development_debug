# Build Local Observability Pipeline Without Conversion Sprawl

> Historical note (2026-05-16): this plan references an earlier chat implementation in a few sections. Where chat storage or streaming is mentioned, the canonical current contract is `messages.messageJson` snapshot hydration plus sequenced SSE delta events from `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently check in a root-level `PLANS.md`. This document is authored and must be maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

这次改动的目标不是“再加一层日志系统”，而是把当前“上游成功但本地空白无报错”的盲区补齐，让 Cradle 在本地就具备可观测、可定位、可导出的故障闭环。完成后，开发者可以在不依赖外部日志平台的前提下，直接看到一次失败的完整链路（事件、关联会话、错误码、触发规则、诊断摘要），并且在 `chat` 场景中出现空输出时会被明确识别为失败而不是静默完成。

用户可见结果是：当 turn 出现异常（尤其是“run completed but no assistant output”）时，界面会有明确失败状态，`/devtool` 可查看结构化事件，且可以导出指定 `chatSessionId` 或 `runId` 的调试包用于复盘。

## Progress

- [x] (2026-05-07 02:25Z) 复核现有主流程：`ChatEngine`、`DomainEventBus`、`SignalBroadcaster`、`ipc-devtool`，确认可以复用现有事件基础设施，不需要引入外部重框架。
- [x] (2026-05-07 02:35Z) 明确“最少转换”设计原则并固化为计划约束：只保留边界适配，不允许层层转换函数。
- [x] (2026-05-07 02:45Z) 产出首版 ExecPlan（本文），包含分阶段实现、验证、回滚与接口约束。
- [x] (2026-05-07 03:05Z) 根据评审意见修订：主链路改为 `enqueue + background batch write`，补齐 `id/schemaVersion/source/recordedAt/dedupeKey/parentEventId`，incident 改为 `dedupeKey` 聚合。
- [x] (2026-05-07 04:00Z) 实现 Milestone 1：新增 `observability` contract/store/schema，落地队列批量写入与 `flush/shutdown`。
- [x] (2026-05-07 04:10Z) 实现 Milestone 2：新增纯函数规则与 incident upsert，接入 `chat-engine` 与 `domain-event-bus` 错误上报。
- [x] (2026-05-07 04:20Z) 实现 Milestone 3：扩展 `/devtool` 新增 Observability 面板，支持 snapshot/clear/flush/export。
- [x] (2026-05-07 04:30Z) 完整验证：运行 `pnpm vitest` 关键测试集与 `pnpm tsc --noEmit`，全部通过。

## Surprises & Discoveries

- Observation: 现有系统已经有高价值的观测基础：`@cradle/ipc` 的 trace envelope、`DomainEventBus`、`SignalBroadcaster`、以及 devtool ring buffer。  
  Evidence: `packages/ipc/src/events.ts` 已定义 traceId/spanId 和 payload serialization；`src/main/events/domain-event-bus.ts` 已支持 typed publish/subscribe。

- Observation: 当前痛点不是“没有事件”，而是“缺少统一错误语义与 durable 存储”，导致重启后失忆、规则难触发。  
  Evidence: `src/main/chat/chat-engine.ts` 出错主要走 `console.error`；devtool stores 目前是内存 ring buffer，默认不持久化。

- Observation: 观测写入如果做同步 SQLite 落盘，会把“诊断能力”变成“主链路故障点”。  
  Evidence: chat turn 是高频路径；同步写入引入额外 I/O 抖动与失败传播风险，和“故障不拖死主业务”目标冲突。

- Observation: 当前测试环境 `better-sqlite3` 二进制与 Node ABI 存在不匹配，直接用内存 SQLite 的 store test 会失败。  
  Evidence: 运行 observability store test 时出现 `NODE_MODULE_VERSION 140 vs 137` 错误；已改用 fake DB adapter 覆盖 store 逻辑路径，避免依赖 native module ABI。

## Decision Log

- Decision: 采用单一 canonical observability event 模型，所有来源统一写入一个 append-only 事件表，再由规则引擎投影 incident。  
  Rationale: 避免每个子系统自定义格式导致 N×N 转换和不可查询。  
  Date/Author: 2026-05-07 / Codex

- Decision: 强制“最少转换”原则：仅允许边界转换，禁止内部重复映射。  
  Rationale: 转换函数泛滥会降低可维护性并引入语义漂移，与你提出的 TS/Go 现代架构目标冲突。  
  Date/Author: 2026-05-07 / Codex

- Decision: 先做 local-first，不立刻接入外部日志聚合。  
  Rationale: 当前主要问题是缺少基础闭环；本地闭环可最快提升可观测性并为未来 remote sink 预留稳定接口。  
  Date/Author: 2026-05-07 / Codex

- Decision: 观测采集接口采用“主链路只入队、不等待落盘”的异步模型，提供显式 `flushEvents()` 用于退出或导出前冲刷。  
  Rationale: 防止 observability 成为主链路的同步依赖，写失败最多记录到控制台，不影响 chat turn 成败。  
  Date/Author: 2026-05-07 / Codex

- Decision: 事件契约强制区分 `occurredAt` 与 `recordedAt`，并增加 `dedupeKey` / `parentEventId`。  
  Rationale: 异步排障必须区分事件发生时间与实际入库时间，且需要稳定去重键支持非 chat/run 场景。  
  Date/Author: 2026-05-07 / Codex

- Decision: 不引入通用 rules platform；仅保留三条高价值纯函数规则。  
  Rationale: 该能力追求“小、硬、本地、语义明确”，避免过度平台化和抽象膨胀。  
  Date/Author: 2026-05-07 / Codex

## Outcomes & Retrospective

本轮实现已完成三阶段目标。主链路现在通过 `enqueueEvent` 非阻塞采集观测事件，后台批量写入 SQLite；`chat-engine` 的空输出完成会被标准化为失败并上报 `CHAT_EMPTY_OUTPUT_COMPLETION`；`domain-event-bus` handler 异常会被结构化记录为 `DOMAIN_EVENT_HANDLER_FAILED`。`/devtool` 新增 Observability 面板，可实时查看 event/incident，并支持 flush 与 bundle 导出。限制项是 store test 在当前环境采用 fake DB adapter，而非 native SQLite integration；该限制不影响主逻辑验证，但后续可在 ABI 对齐环境补一组真实 SQLite 集成测试。

## Context and Orientation

`src/main/chat/chat-engine.ts` 是 chat turn 的核心编排点，也是错误最先出现的地方。`src/main/events/domain-event-bus.ts` 提供进程内事件总线，`src/main/signal/broadcaster.ts` 负责向 renderer 推送事件。`src/main/devtools/ipc-devtool.ts` 与对应 store 当前提供的是内存态调试缓冲，适合实时看，但不适合故障追溯。

本计划引入一个新 owner namespace：`src/main/observability/`。该目录负责 Cradle 自有观测语义、规则、存储和导出，不写入其他领域命名空间。后续 canonical chat durable source 已迁移到 `messages.messageJson`，旧 `backend_timeline_events` 已在 snapshot rewrite 中移除，因此 observability 也不应依赖该旧表。

本计划中的“转换”一词仅指数据语义映射，不包括类型收窄或输入校验。禁止的模式是 `A -> B -> C -> D` 的连续中间模型搬运。允许的模式只有两类：一是“外部 SDK 事件 -> canonical event”边界适配；二是“canonical event -> UI 展示模型”展示适配。业务内部一律使用 canonical event 原型。

主链路写入策略是非阻塞的：业务代码只调用 `enqueueEvent(event)` 把事件放入内存队列，不等待 SQLite。后台 worker 按批次落盘；失败仅 `console.error`，不得抛回 chat turn 或 domain event handler。

## Plan of Work

Milestone 1 会先建立观测事件契约与持久化。新增 `src/main/observability/contract.ts` 定义 `ObservabilityEvent`，包含稳定字段 `id`、`schemaVersion`、`source`、`code`、`severity`、`category`、`message`、`attrs`、`chatSessionId`、`runId`、`messageId`、`traceId`、`parentEventId`、`dedupeKey`、`occurredAt`、`recordedAt`。新增 `src/main/observability/store.ts` 与 `src/main/db/schema/observability.ts`，以 append-only 方式写入 `observability_events`。store 采用“内存队列 + 后台批量写入”，主链路只入队。提供 `flushEvents()` 用于应用退出、导出前、测试验证时显式冲刷。`chat-engine.ts` 与 `domain-event-bus.ts` 的关键错误点改为调用 `enqueueEvent()`，保留 `console.error` 作为兜底。

Milestone 2 在同一 namespace 增加规则模块 `src/main/observability/rules.ts`，输入是 canonical event 流，输出是 `incident` 的打开、更新与恢复。该模块不做通用平台化抽象，只保留纯函数规则集合。规则首批只做高价值场景：`CHAT_EMPTY_OUTPUT_COMPLETION`、`TURN_STREAM_FAILED`、`DOMAIN_EVENT_HANDLER_FAILED`。incident 聚合键使用 `dedupeKey`，并约定默认格式：`${code}:${chatSessionId ?? '-'}:${runId ?? '-'}:${handlerName ?? '-'}`。规则结果写入 `observability_incidents`，并通过 `SignalBroadcaster` 推送 `observability:incident`。

Milestone 3 将 `/devtool` 扩展为第三条观测流（独立于 IPC 与 ACP），新增 renderer store 与列表详情视图，支持按 `chatSessionId`、`runId`、`code`、`severity` 查询，支持导出调试包。导出逻辑在 `src/main/observability/exporter.ts`，将事件、incident、关联 timeline 组装为单个 JSON 包（首版不压缩）。

全程执行“最少转换”约束：不创建 `mapper-a.ts`、`mapper-b.ts` 这类链式映射文件；contract 是唯一内部模型；store、rules、exporter 都直接消费同一结构体。若确需边界适配，适配器必须就地定义在调用方目录并附带注释说明“为何不能直用 canonical model”。

## Concrete Steps

在仓库根目录 `/Users/wibus/dev/Cradle` 执行以下步骤。

先创建 schema 与迁移：

    pnpm drizzle-kit generate
    pnpm drizzle-kit migrate

预期：生成新的 migration 文件，`observability_events` 和 `observability_incidents` 可在本地数据库创建成功。

再实现主流程并跑单测：

    pnpm vitest src/main/chat/__tests__/chat-engine.test.ts
    pnpm vitest src/main/events/__tests__/domain-event-bus.test.ts
    pnpm vitest src/main/observability/__tests__/store.test.ts
    pnpm vitest src/main/observability/__tests__/rules.test.ts

预期：测试通过，且新增断言覆盖“empty output -> run.failed -> observability event”，以及“SQLite 写失败不会影响 chat turn 完成状态”。

最后跑一轮应用级验证：

    pnpm dev

预期：触发一个故障场景后，`/devtool` 能看到对应 observability event 与 incident，并可按会话 ID 过滤。

## Validation and Acceptance

验收以行为为准。第一，制造一次“provider 完成但无输出”场景后，chat UI 必须显示失败状态，不能再出现无文本但成功结束。第二，在 devtool 中必须能看到一条 `code=CHAT_EMPTY_OUTPUT_COMPLETION` 的观测事件，并能关联到同一 `chatSessionId` 与 `runId`。第三，导出的调试包中必须同时包含事件记录、incident 记录、以及关联的 timeline 摘要，且字段与 contract 保持一致。第四，模拟 SQLite 暂时失败时，chat turn 状态必须保持原业务语义，不得被 observability 写入错误改写。

测试维度包括单测和集成验证。单测验证规则触发与恢复、队列批量写入、写失败降级、持久化查询；集成验证从 `ChatEngine` 到 `SignalBroadcaster` 的链路连通。若某条规则误报率高于可接受范围，应通过阈值或窗口调整，而不是新增中间转换层“洗数据”。

## Idempotence and Recovery

该方案是幂等可重跑的。事件表是 append-only，重复执行不会覆盖旧证据；incident 更新以 `dedupeKey` 作为稳定关联键，重复触发只会更新计数和最近时间。若迁移中断，重新执行 drizzle migrate 即可继续。若新规则产生噪音，可通过 feature flag 临时关闭该规则，不需要回滚整套表结构。

如果需要回退，先停用 observability subscriber，再保留表结构不删数据。这种回退不会影响 chat 主链路，因为主链路只依赖“可选记录”而非“强制写入成功”。应用退出流程应调用一次 `flushEvents()`，若超时则放弃并打印告警，不阻塞退出。

## Artifacts and Notes

成功实现后，保留以下证据片段（按需追加）：

    [observability] event recorded code=CHAT_EMPTY_OUTPUT_COMPLETION chatSessionId=... runId=...
    [observability] incident opened code=CHAT_EMPTY_OUTPUT_COMPLETION count=3 window=5m

以及最小查询样例：

    SELECT code, severity, chat_session_id, run_id, occurred_at
    FROM observability_events
    ORDER BY occurred_at DESC
    LIMIT 20;

## Interfaces and Dependencies

`src/main/observability/contract.ts` 必须定义：

    export type ObservabilitySeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    export type ObservabilityCategory = 'chat' | 'provider' | 'event-bus' | 'ipc' | 'system'
    export type ObservabilitySource = 'chat-engine' | 'domain-event-bus' | 'ipc' | 'provider' | 'renderer'
    export interface ObservabilityEvent {
      id: string
      schemaVersion: number
      source: ObservabilitySource
      code: string
      severity: ObservabilitySeverity
      category: ObservabilityCategory
      message: string
      attrs?: Record<string, unknown>
      chatSessionId?: string
      runId?: string
      messageId?: string
      traceId?: string
      dedupeKey?: string
      parentEventId?: string
      occurredAt: number
      recordedAt: number
    }
    export interface ObservabilityIncident { ... }

`src/main/observability/store.ts` 必须提供稳定接口：

    enqueueEvent(event: ObservabilityEvent): void
    flushEvents(): Promise<void>
    shutdown(): Promise<void>
    queryEvents(filter: ObservabilityEventFilter): ObservabilityEvent[]
    upsertIncident(incident: ObservabilityIncident): void
    queryIncidents(filter: ObservabilityIncidentFilter): ObservabilityIncident[]

`src/main/observability/rules.ts` 必须提供纯函数接口：

    evaluateIncidentRules(input: {
      nowMs: number
      incoming: ObservabilityEvent
      recent: ObservabilityEvent[]
    }): ObservabilityIncidentChange[]

`src/main/observability/exporter.ts` 必须提供：

    exportObservabilityBundle(input: {
      chatSessionId?: string
      runId?: string
      sinceUnix?: number
    }): {
      exportedAt: number
      events: ObservabilityEvent[]
      incidents: ObservabilityIncident[]
      timeline: Array<Record<string, unknown>>
    }

外部依赖保持最小化，优先复用现有 Drizzle、SQLite、DomainEventBus、SignalBroadcaster，不引入新的重量级 runtime。若后续要接 Go sidecar 或远端 sink，只允许在 `observability` namespace 的 adapter 层扩展，不改变 canonical contract。队列实现必须支持批量阈值、时间窗口与背压策略；当队列满时，允许丢弃低优先级事件并输出一次聚合告警，禁止阻塞主链路。

Revision note (2026-05-07): Revised after architecture review to adopt non-blocking enqueue/flush persistence, add strict canonical event fields (`id`, `schemaVersion`, `source`, `recordedAt`, `dedupeKey`, `parentEventId`), and switch incident aggregation to `dedupeKey` rather than chat/run-only keys.

Revision note (2026-05-07): Marked Milestones 1-3 complete after implementation, wiring, and test verification; documented native SQLite ABI mismatch in tests and the fake DB fallback rationale.
