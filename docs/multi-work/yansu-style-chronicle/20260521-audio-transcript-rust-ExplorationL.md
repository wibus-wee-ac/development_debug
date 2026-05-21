# Yansu-Style Chronicle Audio Transcript Rust Exploration

## 结论

当前 `chronicle/` Rust crate 还没有真实音频采集、VAD、ASR 或 speaker labeling。最小可落地集成点不是伪造音频 runtime，而是在 Rust 侧新增一个“已生成 transcript artifact 后的 best-effort 上报边界”，复用现有 Server `POST /chronicle/memories` 作为转录文本 ingest route，并通过 `metadata` 标明来源、音频片段时间、runtime 状态和“不含真实 VAD/ASR”的 provenance。

如果要保持实现诚实，第一步只能支持“外部或 fixture transcript 输入已存在”的上报路径；真实麦克风/系统音频采集、分段、VAD、ASR、speaker embedding 必须作为后续独立 runtime 工作。

## 已阅读范围

- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `docs/draft-solutions/yansu-chronicle-spec.md`
- `chronicle/src/config.rs`
- `chronicle/src/cradle_client.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/recorder/artifacts.rs`
- `chronicle/src/screen/macos.rs`
- `chronicle/src/README.md`
- `chronicle/Cargo.toml`
- `apps/server/src/modules/chronicle/index.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/service.ts`
- `packages/db/src/schema/chronicle.ts`

## 当前 Rust 状态

`chronicle/` 是一个屏幕活动与 OCR daemon，不是音频 daemon。

- `ChronicleConfig` 只包含 storage、inbox、capture provider、display、poll interval、idle timeout、run-once 等配置；没有 audio device、sample rate、channels、VAD threshold、ASR model path 或 speaker model path。
- `CaptureProvider` 只有 `macos` 和 `inbox`。`macos` 使用 CoreGraphics display image capture，加 Vision OCR；`inbox` 读取 fixture/input frame。
- `ArtifactStore` 只持久化 frame image、capture JSON、OCR JSON、snapshot JSON 和 memory markdown；没有 audio chunk、transcript JSON 或 speaker segment artifact 格式。
- `daemon.rs` 的主循环只做 screen capture、dedup/adaptive sampling、idle pause、周期性 summary。
- `cradle_client.rs` 已经是正确的 Server HTTP 边界：读取 `/chronicle/config`，调用 `/chronicle/summarize`，并 best-effort 上报 `/chronicle/snapshots` 和 `/chronicle/memories`。
- `Cargo.toml` 没有任何音频或 ASR 依赖，例如 `cpal`、`hound`、`sherpa-onnx`、`whisper-rs` 或 ONNX runtime binding。

现有 Rust 上报结构：

```rust
pub struct ChronicleSnapshotReport {
    pub source_id: String,
    pub display_id: u32,
    pub frame_index: u64,
    pub captured_at: String,
    pub segment_dir: String,
    pub frame_path: String,
    pub capture_path: String,
    pub ocr_path: String,
    pub snapshot_path: String,
    pub ocr_text: String,
}

pub struct ChronicleMemoryReport {
    pub source_id: String,
    pub window_type: String,
    pub created_at: String,
    pub memory_path: String,
    pub content: String,
    pub summary_kind: String,
    pub source_snapshot_paths: Vec<String>,
    pub source_frame_paths: Vec<String>,
}
```

## Server 可复用接口

当前没有专门的 transcript route。可以直接复用 `POST /chronicle/memories`，因为 Server 的 `recordMemory()` 会：

- 按 `sourceId` upsert；
- 使用 canonical content hash 做 duplicate merge；
- 写入 `chronicle_memories`；
- 重建 `chronicle_memory_chunks`、`chronicle_memory_keywords` 和 `chronicle_memory_embeddings` 的 lexical vector index；
- 支持 `/chronicle/memories/search` 被检索到。

当前 route schema 限制：

```ts
memoryReportBody: {
  sourceId: string
  windowType: '10min' | '6h'
  createdAt: string
  memoryPath?: string
  content: string
  summaryKind: 'llm' | 'local' | 'imported'
  sourceSnapshotPaths?: string[]
  sourceFramePaths?: string[]
  metadata?: Record<string, unknown>
}
```

因此最小 Rust 侧 transcript 上报应使用：

- `windowType: "10min"`：沿用当前 memory enum，不新增 DB migration。
- `summaryKind: "imported"`：表示 Rust 只是导入已存在 transcript，不声称 LLM/local summarizer 生成。
- `content`: transcript markdown 或 plain text。
- `metadata.kind: "audio-transcript"`：把语义放在 metadata 中，避免改 Server enum。
- `metadata.audioRuntime: "external"` 或 `"fixture"`：明确不是内置 VAD/ASR。
- `metadata.vadImplemented: false`、`metadata.asrImplemented: false`：防止 UI/后续 agent 误判能力。

示例 payload：

```json
{
  "sourceId": "audio-transcript:20260521T120000Z:meeting-alpha",
  "windowType": "10min",
  "createdAt": "2026-05-21T12-00-00Z",
  "memoryPath": "/Users/wibus/.cradle/chronicle/audio-transcripts/20260521T120000Z-meeting-alpha.md",
  "content": "# Meeting Transcript\n\n[00:00:03] Speaker 1: Discussed Chronicle audio ingest boundary.",
  "summaryKind": "imported",
  "sourceSnapshotPaths": [],
  "sourceFramePaths": [],
  "metadata": {
    "kind": "audio-transcript",
    "audioRuntime": "external",
    "vadImplemented": false,
    "asrImplemented": false,
    "speakerLabelingImplemented": false,
    "startedAt": "2026-05-21T12-00-00Z",
    "endedAt": "2026-05-21T12-10-00Z",
    "language": "en",
    "sourceArtifactPaths": [
      "/Users/wibus/.cradle/chronicle/audio-transcripts/20260521T120000Z-meeting-alpha.json"
    ]
  }
}
```

## 推荐最小 Rust 集成点

只做 client/data struct，不接真实 microphone pipeline。

1. 在 `chronicle/src/cradle_client.rs` 增加 `ChronicleTranscriptReport` 或泛化 `ChronicleMemoryReport` metadata 支持。

   当前 `ChronicleMemoryReport` 没有 `metadata` 字段，但 Server 已接受。最小改动是给它加：

   ```rust
   pub metadata: serde_json::Value,
   ```

   或者定义专门结构并在 `record_transcript()` 中 post 到同一个 route：

   ```rust
   pub fn record_transcript(&self, transcript: &ChronicleTranscriptReport) -> ChronicleResult<()> {
       self.post_json("/chronicle/memories", transcript)
   }
   ```

2. 新增 transcript report 结构，保持字段对齐 Server `memoryReportBody`，不要引入未实现 runtime 的字段作为顶层能力。

   ```rust
   #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
   #[serde(rename_all = "camelCase")]
   pub struct ChronicleTranscriptReport {
       pub source_id: String,
       pub window_type: String,
       pub created_at: String,
       pub memory_path: String,
       pub content: String,
       pub summary_kind: String,
       pub source_snapshot_paths: Vec<String>,
       pub source_frame_paths: Vec<String>,
       pub metadata: serde_json::Value,
   }
   ```

3. 如果需要 CLI 验证，可只加 `--report-transcript <path>` 这类导入入口，读取已有 transcript markdown/json 后上报。不要命名成 `--enable-audio`、`--transcribe` 或类似暗示真实 ASR 的 flag。

4. Artifact 路径建议放在 Chronicle capture namespace 下的子目录，例如：

   ```text
   <storage_root>/audio-transcripts/<timestamp>-<slug>.md
   <storage_root>/audio-transcripts/<timestamp>-<slug>.json
   ```

   这里是 Rust daemon 的 capture artifact namespace，不是 Server model resource namespace。不要把 transcript 写到 `CRADLE_DATA_DIR/chronicle/models`。

## 缺失的真实音频/VAD/ASR pieces

这些都还没有实现，handoff 给后续 worker 时必须作为 blocker 或后续阶段列出：

- 音频采集：没有 microphone/system audio permission flow，没有 device enumeration，没有 sample format conversion，没有 ring buffer。
- 系统音频：Yansu spec 提到 ScreenCaptureKit `capturesAudio`，但当前 Rust macOS capture 使用 `CGDisplay::image()`，不是 ScreenCaptureKit stream，也没有 audio frames。
- VAD：Server 有 `audio-vad` model resource manifest，但 Rust 没有加载 `silero_vad.onnx`，没有 sliding window、threshold、speech segment merge。
- ASR：Server 有 `audio-asr` model resource manifest，但 Rust 没有 Sherpa-ONNX/SenseVoice binding，也没有 token/model path resolution。
- speaker labeling：Server 有 `speaker` resource category，但 Rust 没有 speaker embedding extractor/manager。
- transcript persistence：没有 transcript segment schema、word timestamps、speaker turns、audio artifact retention policy。
- privacy/consent：没有 microphone/system audio enablement gate，也没有 UI 配置传到 Rust。
- runtime readiness：Server `GET /chronicle/model-resources` 只能说明模型文件生命周期，不代表 Rust runtime 已加载或可执行。

## 是否需要新增 Server route

最小版本不需要。复用 `POST /chronicle/memories` 足够让 transcript 进入 memory/search/index。

只有当产品需要 timeline 中独立展示 audio event、按 speaker/timecode 查询、或保存 word-level timestamps 时，才建议新增 Server contract，例如：

```http
POST /chronicle/transcripts
```

但这会牵涉新的 TypeBox schema、DB table 或扩展 `chronicle_memories` enum/metadata contract、Web UI 和 tests，不属于“minimal Rust integration point”。

## 风险

- `chronicle_memories.type` 目前只有 `10min | 6h`。把 transcript 塞进 `10min` 是最小路径，但语义不精确；需要依赖 `metadata.kind` 区分。
- `summaryKind` 只有 `llm | local | imported`。transcript 应用 `imported`，不能新增 `"transcript"`，否则 Server schema 会拒绝。
- 如果 transcript content 与 summary content 混在 memory list 中，Web UI 目前不会特殊标识 audio transcript，除非后续读取 metadata 做 badge。
- 现有 Rust `post_json()` 超时是 `CONFIG_TIMEOUT = 5s`。长 transcript payload 仍是普通 JSON body，通常可用，但大会议转录可能需要更长 timeout 或 chunking。
- 直接上报 transcript text 会进入 Server DB 和 search index；必须先明确隐私开关、retention 和用户 consent。
- 不能把 model resource availability 当作 runtime readiness。`audio-vad` / `audio-asr` installed 只代表文件存在，不代表 Rust 可加载、可推理、可产生 transcript。

## 推荐验证命令

文档/探索阶段不需要跑全量验证。实现上述最小 Rust client 后建议运行：

```bash
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
```

如果新增导入 CLI，还应做一个本地 smoke：

```bash
CRADLE_URL=http://127.0.0.1:21423 cargo run --manifest-path chronicle/Cargo.toml -- --report-transcript /tmp/sample-transcript.md
curl 'http://127.0.0.1:21423/chronicle/memories/search?q=Chronicle%20audio%20ingest'
```

预期结果：

- Rust unit test 覆盖 transcript report JSON 字段名、`summaryKind: "imported"` 和 metadata。
- Server `recordMemory()` 接受 payload。
- `/chronicle/memories/search` 能搜到 transcript 内容。
- 日志和 UI 不宣称 VAD/ASR 已启用。

## 建议交给实现 worker 的最小任务

实现 worker 可以只做以下小范围改动：

- `chronicle/src/cradle_client.rs`: 增加 transcript report struct、`record_transcript()`、serialization test。
- 可选 `chronicle/src/config.rs` / `main.rs`: 增加明确叫 `--report-transcript` 的导入入口，仅上报已有文件。
- 不改 `chronicle/src/screen/*`，不加 audio capture dependency，不接 Sherpa-ONNX。
- 不改 Server schema，除非后续明确需要 first-class transcript route。
