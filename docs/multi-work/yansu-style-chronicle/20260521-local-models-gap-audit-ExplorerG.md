# Strategy 1 Chronicle 本地模型差距审计

审计范围：只覆盖本地模型、`audio` / `VAD` / `ASR` / `speaker`、`embedding` / `FTS` / `semantic search` / `dedup`。已读取 `docs/draft-solutions/yansu-chronicle-spec.md`、`chronicle` Rust crate、`apps/server/src/modules/chronicle`、`packages/db/src/schema`、`apps/web/src/features/chronicle`。

## 直接结论

当前 Chronicle 已经有一个可运行的最小屏幕感知路径：Rust daemon 采集 macOS display、用 macOS Vision 做 OCR、对相邻帧做 fingerprint 去重、落 artifact，并通过 Server ingest 成 `chronicle_snapshots` / `chronicle_memories`。这条路径可以替代 Yansu spec 中的 OCR ONNX 模型，属于 P0 可接受的系统能力替代。

真正缺失的是本地模型资源闭环和语义能力：没有 `audio` capture pipeline，没有 `Silero VAD`、`SenseVoice ASR`、speaker embedding，没有 text embedding engine，没有 `FTS5` 索引，没有 semantic search，也没有 spec 要求的 embedding similarity dedup。Server / Web 目前只展示资源状态占位，不能下载、校验、安装或驱动任何模型。

## Spec 目标摘录

`docs/draft-solutions/yansu-chronicle-spec.md` 对本审计范围的要求包括：

- OCR：默认是 ONNX Runtime 本地 `model.onnx` + `vocab.txt`，但明确列出可用替代为 macOS Vision `VNRecognizeTextRequest`。
- Audio：后台系统音频捕获，16kHz mono PCM，`Silero VAD` 分段，`Sherpa-ONNX SenseVoice` ASR，Sherpa speaker embedding 做说话人识别。
- Memory：结晶化后生成 embedding，写入 memory chunk / knowledge store，并用 embedding similarity 做 semantic dedup。
- Search：同时做 semantic search 与 FTS keyword search，然后合并排序。
- 模型下载：通过 manifest / CDN / fallback source 下载，SHA256 校验，本地缓存，状态事件，smoke test。

## 当前实现证据

### OCR 与屏幕感知

- `chronicle/src/screen/macos.rs:19` 到 `chronicle/src/screen/macos.rs:23` 链接 `AppKit` 与 `Vision` framework；`chronicle/src/screen/macos.rs:60` 到 `chronicle/src/screen/macos.rs:67` 采集 `CGImage`、编码 PNG，并调用 `run_vision_ocr`。
- `chronicle/src/screen/macos.rs:300` 到 `chronicle/src/screen/macos.rs:343` 直接构造 `VNRecognizeTextRequest`，设置 accurate recognition、language correction、revision 3、`en-US` / `zh-Hans` / `ja` 语言，以及最小文字高度。
- `chronicle/src/ocr.rs` 没有 ONNX 推理；`ObservedTextExtractor` 只是把 `CapturedFrame.observed_text` 做 whitespace normalize。
- `chronicle/Cargo.toml` 只包含 `core-graphics`、`core-foundation`、`objc2`、`serde_json`、`ureq` 等依赖；未出现 `onnxruntime`、`ort`、`sherpa`、`whisper` 或 tokenizer/embedding 依赖。

判断：OCR ONNX 不存在，但 macOS Vision 替代已经真实可用。

### 相邻帧去重

- `chronicle/src/recorder/fingerprint.rs` 实现 sample-based `FrameFingerprint`，用图片头尾 4KB、完整 normalized OCR text 和总长度计算 hash。
- `chronicle/src/recorder/manager.rs` 在每帧 OCR 后用 `FrameFingerprint::from_parts` 与同 display 上一个 fingerprint 比较，重复则跳过持久化。
- 这只是 adjacent-frame dedup，用于减少重复截图；不是 spec 里的 memory semantic dedup。

### Server 资源状态与搜索

- `apps/server/src/modules/chronicle/service.ts:49` 到 `apps/server/src/modules/chronicle/service.ts:85` 定义了五类 resource baseline：`ocr` 为 `available`，`audio-vad`、`audio-asr`、`speaker`、`embedding` 为 `missing`。
- `apps/server/src/modules/chronicle/service.ts:384` 到 `apps/server/src/modules/chronicle/service.ts:390` 的 `/chronicle/model-resources` 只是读取 `chronicle_model_resources`。
- `apps/server/src/modules/chronicle/service.ts:585` 到 `apps/server/src/modules/chronicle/service.ts:603` 的 `seedModelResources` 只在 DB 中初始化占位行，没有 manifest、download、checksum、install 或 smoke test。
- `apps/server/src/modules/chronicle/service.ts:365` 到 `apps/server/src/modules/chronicle/service.ts:381` 的 memory search 使用 `instr(lower(...))` 搜 `content` / `prompt` / `metadataJson`，不是 FTS，也不是 semantic search。

### DB schema

- `packages/db/src/schema/chronicle.ts:5` 到 `packages/db/src/schema/chronicle.ts:24` 只有 `chronicle_snapshots`，其中 `ocrText` 是普通 text 列。
- `packages/db/src/schema/chronicle.ts:26` 到 `packages/db/src/schema/chronicle.ts:48` 只有粗粒度 `chronicle_memories`，没有 `memory_chunks.embedding`、`memory_index`、`memory_fts_idx`、`knowledge` 或 dream tables。
- `packages/db/src/schema/chronicle.ts:50` 到 `packages/db/src/schema/chronicle.ts:68` 有 `chronicle_model_resources` 状态表，字段足以承载一部分资源状态，但缺少 manifest identity、checksum、download URL、local file inventory、last verified 等闭环字段。

### Web UI

- `apps/web/src/features/chronicle/use-chronicle.ts` 对资源类别固定为 `ocr`、`audio-vad`、`audio-asr`、`speaker`、`embedding`。
- `apps/web/src/features/chronicle/use-chronicle.ts` 默认把 `ocr` 展示为 `available`，其余本地模型为 optional / not installed。
- `apps/web/src/features/chronicle/chronicle-settings.tsx` 只展示资源卡片和 memory search 输入；没有 install / retry / verify / remove 按钮，也没有下载进度事件。

## 真正缺失点

### P0 可接受但需明确边界

- OCR 本地 ONNX 缺失，但已由 macOS Vision 替代。若产品目标只覆盖 macOS，当前路径可以作为 P0 正式路径。
- 当前 OCR 结果只存 snapshot 级 `ocrText` 与 artifact JSON，没有 spec 中 `activity_ocr_frames` / `activity_ocr_fts`。这会影响 OCR keyword search 和后续 segment 级处理，但不阻塞最小截图记忆。

### 必须补的能力

- `audio` capture：Rust crate 没有 ScreenCaptureKit audio、CoreAudio tap、PCM ring buffer 或 meeting detector。
- `VAD`：没有 `silero_vad.onnx`、Sherpa VAD binding、音频分段配置和测试。
- `ASR`：没有 `SenseVoice model.int8.onnx`、`tokens.txt`、Sherpa offline recognizer，亦无 Whisper fallback。
- `speaker`：没有 speaker embedding extractor / manager、speaker profile store、threshold 配置或 speaker label 写入模型。
- `embedding`：没有本地 ONNX embedding model、tokenizer、batch inference、normalization、cosine similarity。
- `FTS`：Chronicle DB 没有 FTS5 virtual table；当前 search 是 `instr` 子串扫描。
- `semantic search`：没有 query embedding、vector scan / cosine ranking、keyword + semantic merge。
- `semantic dedup`：只有 source id upsert 和相邻帧 fingerprint；没有 content hash + embedding similarity + time-window text similarity 的三层 memory dedup。

## 可用 macOS Vision 替代的范围

可替代：

- OCR：`VNRecognizeTextRequest` 已经可替代 spec 的 `model.onnx` OCR，并且不需要模型下载、ONNX Runtime 或额外资源管理。
- 屏幕文字语言覆盖：当前实现覆盖 English、简体中文、日文。若要补齐韩文、粤语音频等能力，不属于 Vision OCR 能力，需要另走模型。

不可替代：

- VAD / ASR / speaker embedding：macOS Vision 不处理音频语音识别或说话人 embedding。macOS Speech framework 可作为语音识别替代候选，但它不等价于本地可复现 `SenseVoice` + `Silero` + speaker embedding 闭环，并且 speaker labeling 仍缺。
- Text embedding / semantic search / semantic dedup：Vision 无法替代，需要 embedding 模型或云端 embedding API。

## 必须模型下载或 manifest 管理的资源

建议将 Chronicle-owned resources 与 provider profiles 分离，统一落在 `~/.cradle/chronicle/models/`，由 Server 维护状态，daemon 只消费本地已验证路径。

最小 manifest 至少需要这些资源：

- `audio-vad`：`silero_vad.onnx`，用途是音频语音活动检测，必须有 `sha256`、`sizeBytes`、`version`、`sourceUrl`、`fallbackUrls`。
- `audio-asr`：`SenseVoice model.int8.onnx` 与 `tokens.txt` 必须作为同一 install unit，否则 recognizer 不完整。
- `speaker`：Sherpa speaker embedding model 及其配置文件，需记录 embedding dimension 和 threshold 默认值。
- `embedding`：`model_fp16.onnx` 或其他 text embedding ONNX，必须同时声明 tokenizer 资源、dimension、pooling strategy、max sequence length。

OCR 不应放入必须下载集，除非后续决定支持非 macOS 或需要可控 OCR 精度。当前 macOS P0 应把 `ocr` resource 的 provider 固化为 `macos-vision`，状态由 runtime availability / OS support 决定。

## 最小可用模型资源管理闭环

建议的最小闭环不是直接做完整模型中心，而是补一个 Chronicle-owned resource manager：

1. `manifest fetch`
   - Server 从内置 manifest 或远端 manifest 读取资源定义。
   - manifest 内容包括 `category`、`installUnit`、`files[]`、`sha256`、`sizeBytes`、`version`、`runtime`、`requiredFor`、`sourceUrl`、`fallbackUrls`。

2. `state reconcile`
   - 对 `~/.cradle/chronicle/models/` 做文件存在性与 checksum 校验。
   - 写回 `chronicle_model_resources`：`missing`、`installing`、`installed`、`available`、`error`。
   - `available` 应只表示可被 runtime 加载，不只是文件存在。

3. `download/install`
   - 新增 Server API，例如 `POST /chronicle/model-resources/:category/install`。
   - 下载到 temp path，校验 SHA256 后 atomic rename 到 final path。
   - 失败时保留错误 message，不污染半成品路径。

4. `smoke test`
   - VAD：加载模型并跑一段短 PCM，确认 speech / silence 输出合理。
   - ASR：加载 `model.int8.onnx` + `tokens.txt`，对短测试音频返回非错误结果。
   - Speaker：加载 extractor，确认 dimension 与 manager search 可用。
   - Embedding：对固定短文本生成向量，确认 dimension、finite floats、L2 norm。

5. `runtime handoff`
   - Server 将已验证路径写入 config 或通过 env 传给 daemon。
   - Daemon 启动时拒绝消费 `missing` / checksum failed 的资源，并把错误回写 Chronicle event。

6. `UI control`
   - Web resource card 增加 `Install`、`Retry`、`Verify`、`Remove` 与进度展示。
   - 保持 provider profiles 只负责 LLM summary credentials/model，不拥有这些本地资源生命周期。

## 验证方式

### 静态审计验证

- 确认没有本地模型依赖：

```bash
rg -n "onnx|sherpa|whisper|vad|speaker|embedding|fts5" chronicle/Cargo.toml chronicle/src apps/server/src/modules/chronicle packages/db/src/schema apps/web/src/features/chronicle
```

- 确认 OCR 走 Vision：

```bash
rg -n "VNRecognizeTextRequest|Vision|run_vision_ocr" chronicle/src/screen/macos.rs
```

- 确认 search 不是 FTS / semantic：

```bash
rg -n "instr\\(|fts|embedding|cosine" apps/server/src/modules/chronicle packages/db/src/schema/chronicle.ts
```

### 现有能力回归

- Rust：

```bash
cargo test --manifest-path chronicle/Cargo.toml
```

- Server Chronicle tests：

```bash
pnpm --filter @cradle/server test -- chronicle
```

### 新闭环落地后的验收

- `GET /chronicle/model-resources` 初始应返回 OCR `available`、音频/embedding `missing`。
- 安装 `audio-vad` 后，DB 中该 category 从 `missing` 经过 `installing` 到 `installed` / `available`，并记录 `path`、`version`、`sizeBytes`、checksum metadata。
- checksum 人为破坏后，`Verify` 应回到 `error` 或 `missing`，daemon 不应加载该资源。
- 安装 embedding 后，新增 memory 应有 embedding row，search 同一语义不同关键词的 query 应能命中；同时 keyword search 应走 FTS5 而不是 `instr` 扫描。
- 重复 memory 输入应触发 exact hash 或 semantic dedup，不应只依赖 `sourceId` upsert。

## Strategy 1 交接建议

最小实现顺序建议：

1. 保留 macOS Vision OCR 为 P0，不引入 OCR ONNX 下载。
2. 先补 Chronicle resource manager 与 manifest/schema/API/UI install controls，因为后续 audio 和 embedding 都依赖这个闭环。
3. 再补 embedding + FTS + semantic dedup/search；这比 audio 风险更低，能立刻提升 memory 搜索与去重质量。
4. 最后补 audio VAD/ASR/speaker，因为它需要 native audio capture、模型 binding、权限、性能和长时运行稳定性一起验证。

当前差距不是“缺几个模型文件”，而是“缺资源生命周期 + 推理 runtime + 存储索引 + 搜索/去重调用链”。Chronicle 已经有可用的屏幕 OCR 起点，但本地模型能力目前主要停留在资源状态占位。
