# Activity Recorder

## 目标

Cradle Chronicle 可以从 screen OCR memory 演进为更完整的 activity recorder，但必须保持明确的 ownership 和 privacy boundary。

## Alma 证据

Alma Activity Recorder 记录 screenshots、OCR text、input events、browser URL/tab titles、per-app focus、session analysis、reports、digests、semantic search、keyword search、suggestions，并支持 tray start/stop。

## Cradle 当前状态

Cradle Chronicle 已能 capture screen frames、OCR、artifacts、memory summaries、timeline、resources、settings。但缺 input-event capture、browser URL/tab correlation、app focus history、tray digest/report actions、suggestions。

## Owner / Namespace

`chronicle` 拥有 passive activity records、privacy filtering、memory generation。Desktop 拥有 native capture adapters。Browser plugins 只能通过显式 integration 提供 browser tab metadata。

## 目标行为

- 用户可以 start、pause、resume、stop recording。
- Recording 捕获 screen/OCR，并可选 app focus 与 browser metadata。
- Sensitive windows/apps 可以被排除。
- Reports 与 digests 基于 Chronicle records 生成，并带清晰 provenance。

## API 草案

- `GET /chronicle/status`
- `POST /chronicle/recording/start`
- `POST /chronicle/recording/stop`
- `GET /chronicle/activity/sessions`
- `POST /chronicle/activity/sessions/:id/analyze`
- `GET /chronicle/activity/digest`

## 数据模型

扩展 Chronicle tables，增加 app focus events、browser metadata events、capture source ids、privacy filter decisions、analysis records。

## 验收

- Recording 可从 tray 暂停，不丢失已有 artifacts。
- Excluded apps 不写入 OCR text 或 screenshots。
- Digest 可以引用 source snapshots 和 event ranges。
