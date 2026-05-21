# Chronicle Server Module

此目录负责 Server 侧 Chronicle 行为。Rust daemon 负责本地 capture、OCR 与 artifact 落盘；Server 负责 Cradle-owned 持久化、远程模型调用、资源状态、事件记录和 Web UI API。

## Files

- `index.ts`: `/chronicle/*` HTTP routes，包含 config、status、daemon resources、local model resources reconcile/verify/install/remove、Slack message sources、message list/manual sync、Slack Events API ingress、accessibility evidence list、raw audio segment ingest/list、audio transcript ingest/list、activity segment list、activity segment triage/summarization/crystallization、manual activity pipeline tick、knowledge card list/version list、dream run list/start、pipeline run list、timeline、snapshot frame、memory list/search、snapshot ingest、memory ingest 与 summarize。
- `model.ts`: Elysia TypeBox schemas for Chronicle request and response contracts。
- `service.ts`: DB-backed Chronicle service，读写 preferences、upsert snapshot/accessibility/memory/message/raw audio segment/audio transcript rows、把 snapshot/message/audio/transcript/memory evidence 归入 Chronicle-owned activity sessions/segments、运行 activity segment triage/summarization/crystallization、写入 knowledge cards/version/source links、记录 dream merge dry-run candidates、记录 pipeline runs、维护 Chronicle-owned memory chunk/keyword/embedding index 与 content-hash dedup foundation、管理 Chronicle-owned local model resource manifest/status、调用 configured profile 生成 summary、后台轮询同步 Slack channel history、校验 Slack Events API signatures、记录 Chronicle events，并把 opt-in background audio capture config 投影到 daemon launch options。
- `daemon-manager.ts`: Rust `cradle-chronicle` process lifecycle、restart handoff、audio launch option tracking and resource usage tracking。

## Ownership Notes

Chronicle 的 canonical UI source 是 Cradle DB，不是 artifact filename scan。Artifact files 仍然是本地证据和恢复来源；Server ingest 会把 Rust 上报的 paths 转成 Chronicle storage root 相对路径。

Memory search 由 Chronicle-owned `chronicle_memory_chunks`、`chronicle_memory_keywords` 和 `chronicle_memory_embeddings` 支撑。`recordMemory()` 会为新写入和更新后的 memory 重建 keyword index 与 `chronicle-lexical` 本地向量，并用 canonicalized content hash 做跨 source duplicate merge。当前 semantic ranking 是 deterministic local lexical vector foundation，不是 ONNX embedding runtime，也不是 FTS5 virtual table。

本地小模型资源属于 Chronicle namespace，默认位于 `~/.cradle/chronicle/models/`；在 isolated server data dir 下固定为 `CRADLE_DATA_DIR/chronicle/models/`，不跟随 capture `storageRoot` 写到其他 namespace。Provider profiles 只用于远程 summary generation 的 credentials/model selection，不拥有 OCR、VAD、ASR、speaker 或 embedding 资源生命周期。

Model resource install 接受本地文件或目录映射到内置 manifest；manifest URL 下载只在每个文件都具备 `sourceUrl`、`sha256` 和 `sizeBytes` 时开放，并会在落盘前校验 checksum/size。`GET /chronicle/model-resources` 只读缓存状态；显式 `reconcile` / `verify` 才执行文件检查。

Slack message scanning 也属于 Chronicle namespace。Slack bot token 与 Slack signing secret 明文由 `secrets` module 加密保存；Chronicle 只保存 `botTokenRef`、`signingSecretRef`、channel allowlist、realtime mode、sync status 与 normalized messages。当前实现包含 Server-first Slack `conversations.history` 后台轮询、手动 sync route，以及 Slack Events API webhook ingress。Events API route 使用 raw body HMAC 校验 `x-slack-signature` 与 `x-slack-request-timestamp`，支持 URL verification、channel allowlist、message/app mention ingest 与 duplicate suppression。Socket Mode 目前只保留配置枚举，后续 worker 应复用同一 source config 和 normalized message pipeline。

Raw audio segment ingest 现在是一等 Chronicle-owned evidence contract：`POST /chronicle/audio-raw-segments` 记录 Rust daemon 已经写出的 microphone WAV/metadata artifact，`GET /chronicle/audio-raw-segments` 与 status 会显示最近原始片段。Server 会把 artifact paths 归一化为 Chronicle storage root 相对路径，并用 `sourceId` upsert，避免同一片段重复登记。这个 contract 只表示原始音频证据已登记，不表示 VAD、ASR 或 speaker labeling 已运行。

Audio transcript ingest 现在是一等 Chronicle-owned contract：`POST /chronicle/audio-transcripts` 先保存原始 transcript 与 segments，再派生一条 imported memory 进入 memory search；`GET /chronicle/audio-transcripts` 与 timeline/status 会显示这些转录。这个 contract 只表示 transcript evidence 已导入，不表示 Rust 已经具备真实 audio capture、Silero VAD、SenseVoice ASR 或 speaker embedding runtime。

Accessibility evidence 是 snapshot ingest 的附属证据 contract：`POST /chronicle/snapshots` 可以携带 `accessibility` payload，Server 会写入 Chronicle-owned `chronicle_accessibility_snapshots` 表，并用 accessibility `sourceId` upsert，避免 daemon 重试造成重复 evidence。`GET /chronicle/accessibility-snapshots` 与 status 会显示最近证据、权限状态、provider、窗口文本、tree JSON 和 artifact path。当前 Rust provider 会在 macOS Accessibility permission 授权后轮询 frontmost app 的 `AXUIElement` tree；daemon 也会启动 AXObserver runtime foundation，订阅 frontmost app 的 focused element/window/value/title notifications，frontmost app 变化时重建 observer，并把部分 notification-triggered AX tree evidence 作为 `macos-ax-observer` snapshot accessibility payload 上报。Polling path 的 AX tree 读取失败会降级为 window inventory evidence；observer event path 读取失败会记录 `macos-ax-observer` unavailable evidence 或抑制 privacy-sensitive capture。

Activity pipeline 使用 Chronicle-owned `chronicle_activity_sessions`、`chronicle_activity_segments` 和 `chronicle_pipeline_runs`。Server 在 canonical ingest 入口把 screen snapshots、Slack messages、raw audio segments、audio transcripts 和 direct memories 分配到 activity segments；同 app/window 且未超过 idle/max window 的 evidence 会合并，app/window 切换或时间 gap 会创建新 segment。`GET /chronicle/activity-segments` 和 `GET /chronicle/pipeline-runs` 暴露这些集合结果。`POST /chronicle/activity-segments/:segmentId/triage` 会用当前 configured profile 判定 segment 是否值得保留，并把结果写入 `triageResultsJson` 与 segment metadata；`POST /chronicle/activity-segments/:segmentId/summarize` 会先复用或执行 triage，再生成结构化摘要并写入 searchable memory。`POST /chronicle/activity-segments/:segmentId/crystallize` 会复用/触发 summary，再把模型输出验证为 Chronicle-owned knowledge cards、versions 和 source links。`activityPipelineEnabled` 开启后，Server 会启动后台 scheduler，按 `activityPipelineIntervalMs` 和 `activityPipelineBatchSize` 自动推进最早的待处理 segment；`POST /chronicle/activity-pipeline/tick` 可手动执行同一推进逻辑。Pipeline `sourceKey` 包含 segment/stage/evidence hash，retry 不会重复调用模型或重复生成 memory/card；如果模型配置或调用失败，segment 和 run 都保持 error，不会假装成功。

Knowledge 与 dream merge foundation 使用 Chronicle-owned `chronicle_knowledge_cards`、`chronicle_knowledge_versions`、`chronicle_knowledge_sources`、`chronicle_dream_runs` 和 `chronicle_dream_candidates`。Knowledge card 通过 `stableKey`、content hash、version 和 normalized source links 支撑幂等 retry 与审计。Dream run 默认只执行 lexical dry-run candidate 记录，使用 `chronicle-lexical/v1`，不会修改 memories 或 knowledge cards；显式 apply merge 才会创建 merged card 并把原 card 标记为 `merged`。这仍不是自动后台 dream scheduler，也不是 ONNX semantic merge。

Background audio capture 是单独 opt-in 的 preference。Server 保存 `audioCaptureEnabled`、`audioSegmentMs`、`audioSegmentIntervalMs` 和 `audioRmsThreshold`，并只在用户开启时把 `--audio-capture` 传给 Rust daemon。Status 的 `audioRuntimeStatus` 只表示 daemon 当前是否以 microphone segment mode 启动；它不表示 system audio、VAD、ASR 或 speaker labeling runtime ready。
