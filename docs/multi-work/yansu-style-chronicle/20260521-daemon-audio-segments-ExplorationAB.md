# Daemon Audio Segments Exploration AB

## 结论

当前 Server/Web 没有独立于 diagnostics 的用户可见后台音频捕获开关。`ChronicleModel.config` 只有 `profileId`、`modelId`、`workspaceId`、`enabled` 和 `storageRoot`，Server config interface/default/read/write 也只有这些字段；Web 的 `ChronicleConfig` 与 Settings 开关同样只控制整体 Chronicle daemon capture。参见 `apps/server/src/modules/chronicle/model.ts:4`、`apps/server/src/modules/chronicle/service.ts:33`、`apps/server/src/modules/chronicle/service.ts:400`、`apps/web/src/features/chronicle/use-chronicle.ts:19`、`apps/web/src/features/chronicle/chronicle-settings.tsx:178`。

现有 audio surface 是三块：Chronicle-owned local model resources、audio transcript ingest/list contract、Rust microphone diagnostics 的说明性状态。它能展示/导入 transcript evidence，但还没有“用户启用后台音频 segment runtime”的配置语义。ExecPlan 明确说 transcript contract 不等于 local audio capture、Silero VAD、SenseVoice ASR 或 speaker embedding runtime readiness；microphone diagnostics 也不接入 transcript/memory generation。参见 `docs/exec-plans/20260521-03-yansu-style-chronicle.md:111`、`docs/exec-plans/20260521-03-yansu-style-chronicle.md:278`、`docs/exec-plans/20260521-03-yansu-style-chronicle.md:331`。

## 现有配置与 UI 面

- Server route 面已有 `GET/PUT /chronicle/config`、`GET /chronicle/status`、`GET/POST /chronicle/audio-transcripts`、`GET /chronicle/model-resources` 等；没有 audio settings route。参见 `apps/server/src/modules/chronicle/index.ts:7`、`apps/server/src/modules/chronicle/index.ts:93`。
- `updateConfig()` 只在整体 `enabled` 从 false 变 true 时启动 Rust daemon，并只传 `storageRoot` 给 `DaemonManager.startDaemon()`。没有把 audio mode 或 diagnostic mode 作为 Server-owned config 写入。参见 `apps/server/src/modules/chronicle/service.ts:423`。
- Web 的 “Capture” Switch 只写 `{ enabled }`，`canEnable` 只要求 profile/model。它没有独立 audio toggle，也没有根据 VAD/ASR/speaker runtime 控制 audio feature。参见 `apps/web/src/features/chronicle/chronicle-settings.tsx:158`、`apps/web/src/features/chronicle/chronicle-settings.tsx:178`。
- Web 已展示 Local Model Resources，默认把 `audio-vad`、`audio-asr`、`speaker` 标为 optional，并提供 local file/directory install、verify、remove 操作。参见 `apps/web/src/features/chronicle/use-chronicle.ts:163`、`apps/web/src/features/chronicle/use-chronicle.ts:683`、`apps/web/src/features/chronicle/chronicle-settings.tsx:250`。
- Web 已展示 Meeting Transcripts、transcript count 和 audio timeline entry，但文案是 imported transcript reports，不是 live background audio capture。参见 `apps/web/src/features/chronicle/chronicle-settings.tsx:221`、`apps/web/src/features/chronicle/chronicle-settings.tsx:260`。

## 最小 Server/Web 变更建议

如果 Rust 增加 daemon audio segment mode，Server/Web 最小变更应是一个明确 opt-in 的 config extension，而不是复用 diagnostics 或整体 `enabled`：

- 在 Server `ChronicleConfig` / `ChronicleModel.config` / config read-write 中增加一个稳定字段，例如 `backgroundAudioEnabled: boolean`，默认 false。它表示“允许 daemon 尝试后台音频 segment/transcript pipeline”，不表示 runtime 已 ready。
- 在 Web `ChronicleConfig` adapter 和 Settings 页新增单独的 “Background Audio” row。该开关应依赖整体 Chronicle enabled，但不应把 model resource installed 直接渲染为 runtime ready。
- 在 Server status 或一个 small capabilities shape 中暴露 daemon-reported audio runtime state，例如 `audioRuntime: disabled | unavailable | starting | running | error`，以及 `vadRuntimeReady`、`asrRuntimeReady`、`speakerRuntimeReady` 这类由 Rust runtime 实际探测后回报的布尔状态。Web 使用这个状态解释为什么 enabled 但未产出 transcript。
- 继续复用 model resources UI 作为 prerequisites/install surface：`audio-vad`、`audio-asr`、`speaker` 可以显示 installed/missing，但 Web 文案要区分 “resource file present” 和 “runtime loaded and active”。
- 若 Rust 仍通过 `/chronicle/audio-transcripts` 上报 finalized ASR output，Server route 不需要新增 ingest endpoint；只需要 config/status surface 让用户启用并理解该 mode。

这和 Yansu spec 的目标一致：Yansu 背景音频是 ScreenCaptureKit system audio + VAD + ASR + speaker pipeline，audio segments 会进入 activity pipeline 和 meeting transcript context；Cradle 当前应该只把对应 capability 暴露为 opt-in feature 和 runtime state。参见 `docs/draft-solutions/yansu-chronicle-spec.md:351`、`docs/draft-solutions/yansu-chronicle-spec.md:509`、`docs/draft-solutions/yansu-chronicle-spec.md:638`。

## DB 结论

现在不需要 DB schema 变更，只要 Rust daemon 输出的是 transcript/report 级别的 evidence，而不是要查询 raw PCM/VAD-only segment。现有 schema 已有：

- `chronicle_audio_transcripts`：source/status/timing/title/language/app/window/audioPath/transcriptPath/metadata/memoryId。参见 `packages/db/src/schema/chronicle.ts:117`。
- `chronicle_audio_segments`：transcriptId、segmentIndex、startMs/endMs、speakerLabel、text、confidence、language、metadata。参见 `packages/db/src/schema/chronicle.ts:144`。
- `chronicle_memories` 和 memory index contract：`recordAudioTranscript()` 会从 transcript segments 派生 imported memory，后续进入 timeline/search/memory list。参见 `apps/server/src/modules/chronicle/service.ts:1086`、`apps/server/src/modules/chronicle/service.ts:1188`、`apps/server/src/modules/chronicle/service.ts:1572`。
- Status/timeline 已读 transcript counts 和 audio entries。参见 `apps/server/src/modules/chronicle/service.ts:543`、`apps/server/src/modules/chronicle/service.ts:673`。

需要新 DB 表的情况应推迟到明确需求出现：保留 raw audio chunks、保存 VAD-only non-transcribed segments、对 speaker identities 建 profile/lifecycle、或对 streaming partial transcripts 做可恢复状态机。当前 daemon audio segment mode 可用 `audioPath`、`transcriptPath`、segment `metadataJson`、transcript `metadataJson` 承载 runtime details。

## 需要避免的风险

- 不要把 `audio-vad` / `audio-asr` / `speaker` model resource `available` 当作 runtime readiness。Server README 和 Web README 已明确 model/resource 与 runtime claim 分离。参见 `apps/server/src/modules/chronicle/README.md:18`、`apps/web/src/features/chronicle/README.md:25`。
- 不要把 diagnostics artifacts 自动写成 transcript/memory。ExecPlan 说 diagnostics 只验证 microphone permission/device/PCM/RMS/artifact writing，不接入 transcript ingestion 或 memory generation。参见 `docs/exec-plans/20260521-03-yansu-style-chronicle.md:331`。
- 不要在 Web 文案里说 “ASR ready”、“speaker labeling ready” 或 “background audio capture active”，除非 Rust daemon 已实际初始化 capture + VAD + ASR/speaker runtime 并把状态上报给 Server。
- 不要用 `source: 'asr'` + `status: 'completed'` 上报非 ASR 内容。Manual/imported transcripts 应继续用 `manual` 或 `imported`，Server 当前 defaults 会把未标明 ASR 的 input 当 imported。参见 `apps/server/src/modules/chronicle/service.ts:1109`。
- 不要跳过 timestamp/segment validation。Server 已对 invalid transcript timestamp 和 reversed segment ranges 返回 400，新的 daemon path 应继续满足这个 contract。参见 `apps/server/src/modules/chronicle/service.ts:2494`、`apps/server/src/modules/chronicle/service.ts:2506`。

## 推荐下一步

先做 Server/Web config/status surface，不碰 DB：

1. 扩展 `ChronicleConfig`，默认 `backgroundAudioEnabled: false`。
2. 让 Rust daemon 获取 config 后按该字段决定是否启动 audio segment mode。
3. 增加 daemon audio runtime status 回报或 Server-side derived status，Web 用它解释 disabled/unavailable/running/error。
4. 保持 transcript ingest contract 不变，让 daemon 只在真实 ASR segment 完成时调用 `/chronicle/audio-transcripts`。
5. 更新 Server/Web README，明确 diagnostics、resource installation、runtime readiness、transcript evidence 四者的边界。
