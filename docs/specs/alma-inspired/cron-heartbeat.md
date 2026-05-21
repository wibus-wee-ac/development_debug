<!--
Input: Alma cron/heartbeat evidence and Cradle automation/session-await audit.
Output: Spec for cron jobs, heartbeat, and channel status.
Position: docs/specs/alma-inspired/cron-heartbeat.md
-->

# Cron 与 Heartbeat

## 目标

Cradle 需要把通用 scheduled automation 和 channel heartbeat/status delivery 拆开建模。前者负责时间、运行记录和重试；后者负责外部 channel 的投递状态、健康检查和用户可见诊断。

## Alma 证据

Alma 暴露 cron jobs、heartbeat config/status、Telegram/Discord/Feishu group status、scheduled message delivery，以及和 TTS 相邻的 voice/file delivery 行为。这些证据说明 Alma 把定时任务和外部 channel 状态结合成了用户可见能力。

## Cradle 当前状态

Cradle automation 已支持 RRULE schedules、run-now、runs、artifacts 和 runtime kinds。Session Await 已支持 GitHub checks/reviews。当前没有发现 channel heartbeat/status delivery module。

## Owner / Namespace

`automation` 拥有 schedule definition、run lifecycle、retry policy 和 run artifacts。未来 `channels` 模块拥有 heartbeat target、connector health、delivery status 和外部 channel 语义。具体 connector 只能通过 channel-owned API 上报状态，不能直接写 automation tables。

## 目标行为

- 用户可以用现有 automation 语义创建 recurring jobs。
- Channel connector 可以声明 heartbeat target，并展示最后一次投递结果。
- Heartbeat run 同时产生 automation run record 和 channel delivery attempt。
- Missed 或 failed jobs 必须暴露结构化 retry 信息和 connector diagnostics。
- 关闭 channel 后停止新的 heartbeat delivery，但保留历史运行记录。

## API 草案

- `GET /automations`
- `POST /automations`
- `GET /channels/heartbeat/status`
- `PUT /channels/heartbeat/config`
- `POST /channels/:id/heartbeat/test`

## 数据模型

Automation 继续保存 schedule、run 和 artifact records。Channels 保存 heartbeat target config、last delivery status、connector health snapshot、last error classification 和 retry cursor。两者通过 stable run id 关联，不共享所有权。

## 验收

- Scheduled channel heartbeat 会记录一条 automation run 和一条 channel delivery attempt。
- 禁用 channel 不会删除 automation history。
- Heartbeat delivery 失败时能区分 auth、network、rate limit、remote rejected、payload invalid 等诊断。
