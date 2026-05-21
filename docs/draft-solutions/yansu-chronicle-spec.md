# Yansu — 完整可复现 SPEC

## 概述

Yansu 是一个**桌面活动智能助理**系统。它在后台录制用户屏幕，通过 OCR 和 Accessibility API 提取信息，结合系统音频转录和消息应用监听，构成多维度活动感知层。然后通过 LLM 驱动的管道将原始活动转化为结构化长期记忆（"结晶化"），供 Agent 对话、搜索和自动化使用。

**技术栈**: Go 1.24.13 (Wails v2) + React 19 / TypeScript + SQLite + ONNX Runtime + Sherpa-ONNX

**核心哲学**: Listen（感知）→ Crystallize（理解）→ Solve（执行）

---

## 架构总览

```
┌────────────────────────────────────────────────────────────────┐
│                    React Frontend (Wails WebView)               │
│              Session GUI / Settings / Memory Viewer / Crystals  │
├────────────────────────────────────────────────────────────────┤
│               Wails IPC Bridge (JS ⇄ Go, window.wails)          │
├────────────────────────────────────────────────────────────────┤
│                       Go Backend (核心引擎)                      │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │   LISTEN 感知层  │→ │ CRYSTALLIZE 理解层│→ │  SOLVE 执行层  │ │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬───────┘ │
│           │                    │                     │          │
│  ActivityMonitor        MemoryCrystallizer      AgentRunner     │
│  OCRWorker              TriageAgent             MCPHub          │
│  AXObserver             DreamEngine             CUADriver       │
│  AudioTranscriber       DedupEngine             CronScheduler   │
│  MessageScanner         SemanticSearch          HandoffManager  │
│  PipelineEngine         KnowledgeStore          SpotlightInt    │
│  Segmenter              EmbeddingEngine         ChatIntegrations│
├────────────────────────────────────────────────────────────────┤
│                     SQLite Database (modernc.org/sqlite)        │
│  activity_* / memory_chunks / knowledge / cron_jobs / crystals  │
└────────────────────────────────────────────────────────────────┘
```

### 核心数据流

```
Screen CaptureKit ──┐
AXObserver ─────────┤
Audio Capture ──────┤  ┌──────────────────────────┐
Chat Scanners ──────┤→ │  Activity Pipeline        │
(Slack/Discord/     │  │  Snapshots → Segments     │
 Telegram/WeChat/   │  │  → PipelineRuns           │
 Feishu/Teams/      │  └────────────┬─────────────┘
 RingCentral)       │               │
                    │               ▼
                    │  ┌──────────────────────────┐
                    │  │  Triage Agent             │
                    │  │  LLM: worth keeping?      │
                    │  └────────────┬─────────────┘
                    │          Yes  │   No → Discard
                    │               ▼
                    │  ┌──────────────────────────┐
                    │  │  Memory Crystallizer      │
                    │  │  LLM: structured summary  │
                    │  └────────────┬─────────────┘
                    │               │
                    │  ┌────────────┴─────────────┐
                    │  │  Semantic Dedup           │
                    │  │  Embedding similarity >.92│
                    │  └────────────┬─────────────┘
                    │               │
                    │  ┌────────────┴─────────────┐
                    │  │  Knowledge Store          │
                    │  │  + Embedding Index (FTS)  │
                    │  └────────────┬─────────────┘
                    │               │
                    ▼               ▼
             Activity Store   Memory / Knowledge
                                   │
                              ┌────┴────┐
                              │  Agent   │
                              │  Search  │
                              │  MCP     │
                              │  Automation│
                              └─────────┘
```

---

## 模块 1: 感知层 (Listen)

### 1.1 ActivityMonitor — 活动监控器

**目的**: 持续、被动地采集用户桌面活动，是多维度感知的中心调度器。

#### 状态机

```
                  ┌──────────────┐
                  │   Stopped    │
                  └──────┬───────┘
                         │ start()
                         ▼
                  ┌──────────────┐
                  │   Starting   │
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              │  Check Permissions   │
              │  - Screen Recording  │
              │  - Accessibility     │
              │  - Microphone        │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              │  All Granted?        │
              └──────────┬──────────┘
                   Yes   │   No
                         ▼    ▼
                  ┌──────────┐  ┌──────────────────┐
                  │ Running  │  │PermissionDenied  │
                  └────┬─────┘  └──────────────────┘
                       │
     ┌─────────────────┼──────────────────┐
     │                 │                   │
     ▼                 ▼                   ▼
  Screenshot       AX Polling         Audio Feed
     │                 │                   │
     ▼                 ▼                   ▼
  OCR Worker      AX Tree JSON       VAD + ASR
     │                 │                   │
     └─────────────────┼──────────────────┘
                       │
              ┌────────┴─────────┐
              │  Closed Eyes?     │
              │  Yes → Discard    │
              │  No  → Store      │
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │  Store Snapshot   │
              │  + Schedule       │
              │    Processing     │
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │  System Idle?     │
              │  Yes → Pause      │
              └──────────────────┘
```

#### 关键数据结构

```go
type ActivityMonitor struct {
    // 子系统开关
    accessibilityEnabled bool
    screenCaptureEnabled bool
    ocrEnabled           bool
    audioEnabled         bool

    // 子系统实例
    axObserver       AXObserverRef          // macOS AXObserverCreate
    screenCapture    *ScreenCaptureSession
    ocrWorker        *ActivityOCRWorker
    audioRecorder    *AudioRecorder
    speakerExtractor *SpeakerEmbeddingExtractor // SherpaOnnxSpeakerEmbeddingExtractor
    speakerManager   *SpeakerEmbeddingManager   // SherpaOnnxSpeakerEmbeddingManager
    closedEyesDetector *ClosedEyesDetector

    // 配置
    snapshotInterval    time.Duration       // 截图间隔 (默认 ~5s)
    retentionDays       int                 // 数据保留天数
    maxStorageGB        int                 // 最大存储空间
    idleTimeout         time.Duration       // 空闲超时暂停

    // 运行状态
    state               MonitorState        // stopped/starting/running/paused
    currentSessionID    int64
    lastCaptureTime     time.Time
    captureBackoffCount int                 // 降采样计数

    // 管道
    pipeline            *ActivityPipelineEngine
}

// 从二进制 strings 提取的 Monitor 事件:
// "[activity] not started: accessibility=%t screenCapture=%t"
// "[activity] failed to discard pending closed-eyes snapshot %s: %v"
// "[activity-summary] generated summary: %s"
// "activity_pipeline:run updateId=%s"
```

### 1.2 ScreenCapture — 屏幕截图

**目的**: 通过 macOS ScreenCaptureKit 捕获屏幕内容。

#### 技术实现

```
API: ScreenCaptureKit (macOS 13.0+)
  - SCShareableContent: 获取可捕获内容列表
  - SCContentFilter: 过滤显示器和窗口
  - SCStreamConfiguration: 配置捕获参数
  - SCStream: 流式捕获

关键配置:
  - captureResolution: 捕获分辨率
  - capturesAudio: YES (用于后台音频转录)
  - capturesShadowsOnly: 可选 (隐私保护)
  - pixelFormat: kCVPixelFormatType_32BGRA
  - minimumFrameInterval: CMTime(snapshotInterval)
```

#### 隐私过滤

```go
// PrivacyFilter 结构 (推断)
type PrivacyFilter struct {
    excludedBundles []string    // 排除的 App Bundle ID
    excludedTitles  []string    // 排除的窗口标题
    excludedURLs    []string    // 排除的 URL 模式
}

// 排除规则:
// - Chrome 隐身模式: bundle="com.google.Chrome*" + title contains "(Incognito)"
// - Safari 隐私浏览: bundle="com.apple.Safari" + Private Browsing 属性
// - Google Meet: URL "meet.google.com" 或 title "Google Meet"
// - 支付页面: 包含 billing/stripe/checkout 的 URL
// - 敏感应用: 密码管理器等 (com.apple.Passwords, com.1password.*)

// 事件日志:
// "excluding privacy-sensitive window from screen recording"
```

### 1.3 OCRWorker — OCR 文字提取

**目的**: 从截图中提取文字。

#### 技术实现

```
方案 A (Yansu 实际使用): ONNX Runtime 本地模型
  模型: model.onnx (bundled in binary)
  词汇: vocab.txt
  输入: 预处理后的图像张量 (1, 3, H, W)
  输出: logits (1, seq_len, vocab_size) → CTC decode → text

方案 B (可用替代): macOS Vision API VNRecognizeTextRequest
  优点: 无需捆绑模型, 系统内置
  缺点: 不可控, 精度可能不如专用模型
```

#### 处理流程

```go
type ActivityOCRWorker struct {
    ortSession      *ort.AdvancedSession
    ortEnv          *ort.Env
    ortMemoryInfo   *ort.MemoryInfo
    vocab           []string
    inputShape      []int64
    inputName       string
    outputName      string

    // 配置
    maxBatchSize    int
    imageMaxSize    int     // 预处理最大尺寸
    charWhitelist   string  // 字符白名单
    minConfidence   float64

    // 性能统计
    totalProcessed  int64
    avgDurationMs   int64
}

func (w *ActivityOCRWorker) Process(image []byte) (*OCRResult, error) {
    // 1. 图片解码和预处理
    img := decodeJPEG(image)
    img = resize(img, w.imageMaxSize)
    tensor := normalizeAndToTensor(img)

    // 2. ONNX 推理
    input := []ort.Value{ort.NewTensor(w.ortMemoryInfo, tensor, w.inputShape)}
    outputs, err := w.ortSession.Run(w.ortInputName, input, []string{w.ortOutputName})

    // 3. CTC 解码
    logits := outputs[0].FloatData()
    text := ctcDecode(logits, w.vocab)

    // 4. 后处理
    text = postProcess(text, w.charWhitelist, w.minConfidence)

    return &OCRResult{
        Text:      text,
        Confidence: avgConfidence(logits),
        Duration:  duration,
    }, nil
}
```

#### OCR 数据存储

```sql
-- OCR 帧表
CREATE TABLE activity_ocr_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER REFERENCES activity_snapshots(id),
    text_content TEXT NOT NULL,
    ocr_status TEXT DEFAULT 'pending',
    embedding TEXT,   -- JSON float array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- OCR 全文搜索索引
CREATE VIRTUAL TABLE activity_ocr_fts USING fts5(
    text_content,
    content='activity_ocr_frames',
    content_rowid='id'
);
```

### 1.4 AXObserver — Accessibility 观察器

**目的**: 通过 macOS Accessibility API 获取结构化 UI 信息，比 OCR 更精准。

```
C API (通过 cgo 调用):
  1. AXObserverCreate(pid, callback, &observer)
     - 为指定 PID 创建观察器
  2. AXObserverAddNotification(observer, element, notification, refcon)
     - 订阅 UI 事件: kAXFocusedUIElementChangedNotification,
       kAXWindowCreatedNotification, kAXValueChangedNotification 等
  3. AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &value)
     - 获取元素角色: button, text, menu, table, etc.
  4. AXUIElementCopyAttributeValue(element, kAXTitleAttribute, &value)
     - 获取元素标题/标签
  5. AXUIElementCopyAttributeValue(element, kAXValueAttribute, &value)
     - 获取元素当前值
  6. AXUIElementCopyElementAtPosition(_, x, y, &element)
     - 根据坐标获取元素

AX API 调用的 Go 封装 (推断):
  type AXClient struct {
      observer AXObserverRef
      runLoop  CFRunLoopSourceRef
  }
  func (c *AXClient) GetRootElement(pid int32) (AXUIElementRef, error)
  func (c *AXClient) GetAttribute(element AXUIElementRef, attr string) (CFTypeRef, error)
  func (c *AXClient) GetFullTree(element AXUIElementRef) (*AXNode, error)
  func (c *AXClient) GetFocusedElement() (AXUIElementRef, error)
```

### 1.5 BackgroundAudioTranscription — 后台音频转录

**目的**: 捕获系统音频输出（非麦克风），转录为文本，主要用于会议场景。

#### 技术栈

```
音频捕获:  ScreenCaptureKit (SCStream capturesAudio=YES)
音频格式:  16kHz, 16-bit, mono PCM
VAD:       Silero VAD (silero_vad.onnx)
ASR:       Sherpa-ONNX sense-voice (model.int8.onnx)
说话人分离: Sherpa-ONNX SpeakerEmbedding

管道:
  System Audio Buffer
       │
       ▼
  ┌──────────────┐
  │   VAD Model   │ ← 检测语音片段
  └──────┬───────┘
         │ speech segment
         ▼
  ┌──────────────┐
  │  ASR Model    │ ← 语音→文本
  └──────┬───────┘
         │ text
         ▼
  ┌──────────────┐
  │   Speaker     │ ← 说话人识别
  │  Embedding    │
  └──────┬───────┘
         │ labeled text
         ▼
  ┌──────────────┐
  │   Meeting     │ ← 会议转录格式
  │  Transcriber  │    "Me: ..." / "Other: ..."
  └──────────────┘
```

#### 关键结构

```go
type ASRModelConfig struct {
    ModelPath        string  // "sense-voice/model.int8.onnx"
    VADModelPath     string  // "silero_vad.onnx"
    VocabPath        string  // "vocab.txt"
    SampleRate       int     // 16000
    FeatureDim       int     // 80
    NumThreads       int     // 4
    DecodingMethod   string  // "greedy_search"
}

type BackgroundTranscriptionScheduler struct {
    config           ASRModelConfig
    recognizer       *SherpaOnnxRecognizer
    vad              *SherpaOnnxVAD
    speakerExtractor *SherpaOnnxSpeakerEmbeddingExtractor
    speakerManager   *SherpaOnnxSpeakerEmbeddingManager
    audioQueue       chan []float32
    transcript       *MeetingTranscript
    isMeeting        bool
}

// 事件:
// "BackgroundTranscriptionSchedulerWithConfig"
// "background-listening:changed"
// "[background-audio] mic permission status: %d"
// "meeting_flush" / "pre_meeting_flush"
```

#### 会议检测

```go
// 会议检测逻辑 (推断)
func (s *BackgroundTranscriptionScheduler) DetectMeeting(frontApp string, windowTitle string) bool {
    meetingApps := []string{
        "us.zoom.xos",           // Zoom
        "com.google.Chrome",     // Google Meet (Chrome tab)
        "com.microsoft.teams",   // Microsoft Teams
        "com.apple.Safari",      // Whereby/Meet (Safari tab)
        "com.whereby.Whereby",   // Whereby desktop
    }
    meetingURLs := []string{
        "zoom.us/wc/",
        "meet.google.com",
        "teams.microsoft.com",
        "whereby.com",
    }
    // 检查前台应用和 URL
}
```

### 1.6 MessageScanners — 消息应用扫描

**目的**: 被动监听多平台消息。

#### 支持的平台和实现

| 平台 | Daemon | 扫描方式 | Go 包 |
|------|--------|---------|-------|
| Slack | `slack-scan` | WebSocket RTM / Events API | slack-go |
| Discord | `discord-scan` | WebSocket Gateway | discordgo |
| Telegram | `telegram-daemon` | Bot API polling | go-telegram-bot-api |
| WeChat | `wechat-daemon` | Mac 客户端 IPC hook | 原生 cgo |
| Feishu | `feishu-scan` | Open API SDK | larksuite/oapi-sdk-go |
| Teams | `teams-scan` | Microsoft Graph API | microsoftgraph |
| RingCentral | `ringcentral-scan` | REST API | ringcentral-go |

#### 消息处理管道

```go
type MessagePipelineEngine struct {
    source    string       // "slack", "discord", etc.
    scanner   MessageScanner
    dedup     *DedupEngine
    converter *MessageConverter  // 转为统一 ActivityEvent
}

type MessageScanner interface {
    Connect() error
    Disconnect() error
    Scan() (<-chan Message, error)
    SendMessage(channel string, text string, images [][]byte) error
    SendDM(userID string, text string) error
    DownloadFile(url string) ([]byte, error)
}

type Message struct {
    Platform    string     // "slack", "discord", etc.
    ChannelID   string
    UserID      string
    UserName    string
    Text        string
    Images      [][]byte
    Attachments []Attachment
    Timestamp   time.Time
    ThreadID    string
    IsDM        bool
}

// Dedup 检查流程:
// 1. 精确 content hash (SHA256)
// 2. 如果 content_typemoments_json → 检测内容类型
// 3. 如果有 embedding → 语义去重 (dedup_skip / dedup_update)
// 事件:
// "daemon:history:dedup check: %w"
// "dedup_skip: title=%q"
```

### 1.7 PipelineEngine — 活动管道引擎

**目的**: 将原始采集数据流经多个阶段转换为结构化活动记录。

#### 管道阶段

```
Stage 1: Collection    → 采集原始数据
  - Snapshots (JPEG + OCR + AX tree)
  - Audio segments (VAD + ASR text)
  - Chat messages (各平台)
  - Browser URLs

Stage 2: Segmentation  → 按活动边界分段
  - 前台应用切换 → segment boundary
  - 空闲超时 (idleTimeout) → segment boundary
  - OCR 文字突变 → segment boundary

Stage 3: Enrichment    → 补充元数据
  - 时间范围, 应用信息
  - 浏览器 URL, 窗口标题
  - 消息参与者, 会议参与人

Stage 4: Triage        → LLM 分类
  - 将 segment 发送给 TriageAgent
  - 分类: meeting/coding/research/chat/browsing/noise
  - 评分: 重要性 + 置信度

Stage 5: Summarization → LLM 摘要
  - 对每个有价值的 segment 生成摘要
  - 提取关键信息: 决定, 事实, 任务

Stage 6: Storage       → 持久化
  - 写入 activity_sessions / activity_snapshots
  - 写入 activity_segments / activity_pipeline_runs
  - 触发 memory crystallizer (如果产生新知)
```

#### 数据结构

```go
type ActivityPipelineEngine struct {
    segmenter  *Segmenter
    triage     *TriageAgent
    summarizer *ActivitySummarizer
    store      *ActivityStore
}

type ActivityPipelineRun struct {
    ID               string
    SessionID        int64
    StartTime        time.Time
    EndTime          time.Time
    Status           string      // "running", "completed", "failed"
    Stage            string      // 当前阶段
    SnapshotIDs      []int64
    SegmentIDs       []int64
    TriageResults    []TriageResult
    SummaryResults   []SummaryResult
    ErrorMessage     string
}

type Segmenter struct {
    idleTimeout     time.Duration
    minSegmentLen   time.Duration
    appSwitchSplit  bool
}

type ActivitySegment struct {
    ID              int64
    SessionID       int64
    StartSnapshotID int64
    EndSnapshotID   int64
    StartTime       time.Time
    EndTime         time.Time
    SegmentType     string  // meeting, work, browsing, chat, idle
    FrontApp        string
    Title           string
    Summary         string
    Embedding       []float32
}
```

---

## 模块 2: 理解层 (Crystallize)

### 2.1 MemoryCrystallizer — 记忆结晶器

**目的**: 将原始活动数据通过 LLM 转化为结构化长期记忆。这是整个系统最核心的转换。

#### 处理流程

```
Input: ActivitySegment (OCR text + chat messages + meeting transcript + context)
       │
       ▼
  ┌─────────────────────────────────────────────────────────┐
  │ Crystallizer                                             │
  │                                                          │
  │  1. Preprocess:                                          │
  │     - 合并同一 segment 的所有文本来源                       │
  │     - 添加前后 segment 的上下文                            │
  │     - 准备 metadata (时间, 应用, 参与者)                    │
  │                                                          │
  │  2. LLM Call (Crystallize):                              │
  │     - System: memory crystallizer prompt                 │
  │     - Input: preprocessed activity text                  │
  │     - Output: structured JSON (summary, knowledge cards) │
  │     - Model: haiku for routine, sonnet for important      │
  │                                                          │
  │  3. Postprocess:                                         │
  │     - Parse JSON output                                   │
  │     - Split into MemoryChunks (text blocks)               │
  │     - Generate embeddings (ONNX model)                    │
  │     - Create KnowledgeCards (if new knowledge detected)   │
  │                                                          │
  │  4. Semantic Dedup:                                      │
  │     - Check embedding similarity with existing memories   │
  │     - > 92% similar → merge/update (dedup_update)         │
  │     - < 92% similar → create new                          │
  │                                                          │
  │  5. Store:                                               │
  │     - Save MemoryChunks to memory_chunks table            │
  │     - Save KnowledgeCards to knowledge table              │
  │     - Update embedding index                              │
  └─────────────────────────────────────────────────────────┘
       │
       ▼
Output: Structured memories + knowledge cards
```

#### Crystallize Prompt 模板 (从二进制字符串推断)

```
System: You are a memory crystallizer for Yansu. Your role is to convert
raw desktop activity data into structured, actionable knowledge.

Input format:
- OCR text from screen captures
- Chat messages from connected platforms
- Meeting transcripts
- Context from surrounding activity segments

Output format (JSON):
{
  "summary": "One concise sentence describing what the user was doing",
  "segments": [
    {
      "time_range": "HH:MM - HH:MM",
      "activity_type": "coding|meeting|research|communication|browsing",
      "title": "Brief title",
      "description": "Detailed description",
      "applications_used": ["app1", "app2"],
      "participants": ["name1"],
      "key_decisions": ["decision 1"],
      "action_items": ["todo 1"],
      "urls_referenced": []
    }
  ],
  "knowledge_cards": [
    {
      "type": "fact|insight|decision|task|pattern",
      "content": "...",
      "dimension": "technical|business|personal|project",
      "confidence": 0.9,
      "source": "activity|chat|meeting|inference"
    }
  ],
  "tags": ["tag1", "tag2"]
}

Rules:
- Be factual. Do not make up information not present in the evidence.
- Distinguish between observed facts and inferred conclusions.
- Flag low-confidence inferences.
- If the segment is purely entertainment or noise, set activity_type="noise".
- Procedural knowledge (shortcuts, fixes, workflows) is high-value.
- Mark any information derived from screen content with "[chronicle memory]".
```

#### 数据结构

```go
type MemoryCrystallizer struct {
    llmClient      *LLMClient
    embedding      *EmbeddingEngine
    dedup          *DedupEngine
    store          *MemoryStore
    promptTemplate string
    chunkSize      int       // token chunk size
    chunkOverlap   int       // overlap between chunks
}

type MemoryChunk struct {
    ID          string      // UUID
    Content     string      // 文本内容
    Summary     string      // 简短摘要
    Tokens      int         // token 数
    Embedding   []float32   // 向量嵌入 (binary blob in SQLite)
    SourceType  string      // "activity", "chat", "meeting", "manual"
    SourceID    string      // 来源 segment/message ID
    ChunkIndex  int         // 在原文中的序号
    Timestamp   time.Time
    IsArchived  bool
    IsMerged    bool
    MergedInto  string      // 被合并到的 chunk ID
}

type KnowledgeCard struct {
    ID          string
    Title       string
    Content     string
    Dimension   string      // technical, business, personal, project
    Confidence  float64
    SourceChunks []string   // 引用的 chunk IDs
    Tags        []string
    Version     int
    IsDeleted   bool
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

// Crystallizer 事件 (从二进制提取):
// "memory-crystallizer"
// "memory-crystallizer-update"
// "crystallizer not ready"
// "memory:status"
```

### 2.2 TriageAgent — 分类代理

**目的**: 在结晶化之前，先用轻量 LLM 调用判断活动是否值得保留。

```go
type TriageAgent struct {
    llmClient   *LLMClient
    model       string   // 默认 "haiku" (快速且便宜)
    maxTokens   int
    prompt      string
}

type TriageResult struct {
    SegmentID    string
    WorthKeeping bool
    Confidence   float64
    Category     string    // "meeting", "coding", "research", "chat", "browsing", "noise"
    Reason       string
}

// Triage Prompt (推断):
// "Classify this activity segment. Should it be preserved as memory?
//  Categories: meeting, coding, research, communication, entertainment, noise.
//  Consider: does this contain information a future AI agent would benefit from knowing?
//  Output JSON: {keep: bool, category: string, reason: string, confidence: float}"

// 事件:
// "Triage returned empty response"
// "triage agent failed: %w"
// "triage.log"
```

### 2.3 DreamEngine — 梦境引擎

**目的**: 后台定期运行，进行记忆的深度处理——合并相似记忆、归档旧记忆、清理噪声。

#### 运行模式

```go
type DreamEngine struct {
    scheduler    *CronScheduler
    crystallizer *MemoryCrystallizer
    store        *MemoryStore
}

type DreamRun struct {
    ID              string
    RunType         string          // "archive", "merge", "prune", "restore"
    Status          string          // "running", "completed", "failed"
    StartTime       time.Time
    EndTime         time.Time
    InputChunks     int
    OutputChunks    int
    MergedCount     int
    DeletedCount    int
    ConfigJSON      json.RawMessage
    ResultJSON      json.RawMessage
}

// Dream 模式:
// 1. dream-archive:   归档超过 N 天未访问的记忆
// 2. dream-merge:     合并语义相似的记忆 (embedding similarity > 0.85)
// 3. dream-prune:     删除低质量/过期的记忆
// 4. dream-restore:   恢复被误删的记忆
// 5. dream-dryRun:    试运行模式，不实际修改

// Dream 合并逻辑:
func (e *DreamEngine) MergeSimilarMemories() error {
    // 1. 获取所有未归档的记忆 chunks
    // 2. 使用 embedding 聚类 (余弦相似度 > 0.85)
    // 3. 对每个 cluster:
    //    a. 调用 LLM 合并为一条连贯记忆
    //    b. 保存合并后的版本
    //    c. 标记原始 chunks (is_merged=true, merged_into=new_id)
    // 4. 更新 embedding index
}

// 事件:
// "dream-archive" / "dream-restore" / "dream-dryRun"
// "dream-runs.json"
// "memory:status" → "dream-archive-{id}"
// "Merged Memory"
```

### 2.4 DedupEngine — 去重引擎

```go
type DedupEngine struct {
    store     *MemoryStore
    embedding *EmbeddingEngine
}

// 三层去重:
func (e *DedupEngine) Check(item Item) (isNew bool, duplicateOf string) {
    // L1: 精确 content hash 匹配 (SHA256)
    contentHash := sha256Sum(item.Content)
    if existing := e.store.FindByHash(contentHash); existing != nil {
        return false, "exact duplicate of " + existing.ID
    }

    // L2: 语义相似度匹配 (embedding cosine similarity)
    if item.Embedding != nil {
        similar := e.store.FindSimilar(item.Embedding, 0.92) // > 92% similar
        if len(similar) > 0 {
            // 决定是跳过还是更新
            if item.IsUpdate {
                return true, "" // dedup_update: 新版本替换旧版本
            }
            return false, "semantically similar to " + similar[0].ID
        }
    }

    // L3: 时间窗口内的相似文本匹配 (快速过滤)
    recentSimilar := e.store.FindRecentSimilar(item.Timestamp, item.Content, 1*time.Hour)
    if len(recentSimilar) > 0 {
        return false, "recent similar content"
    }

    return true, ""
}

// 事件:
// "dedup_skip: title=%q"
// "dedup_update"
// "exact_dupl"
// "semantically similar to %q"
// "[cron] AddJob: semantic duplicate of %q"
// "[cron] AddJob: semantic dedup failed (proceeding): %v"
```

### 2.5 EmbeddingEngine — 嵌入引擎

```go
type EmbeddingEngine struct {
    modelPath   string     // ONNX embedding model path
    ortEnv      *ort.Env
    ortSession  *ort.AdvancedSession
    dimension   int
    batchSize   int
    seqLength   int
}

func (e *EmbeddingEngine) GenerateEmbeddings(texts []string) ([][]float32, error) {
    // 1. Tokenize texts (使用模型自带 tokenizer 或 HuggingFace tokenizer)
    // 2. ONNX inference (batch processing)
    // 3. Mean pooling / [CLS] token extraction
    // 4. L2 normalization
}

func (e *EmbeddingEngine) CosineSimilarity(a, b []float32) float64 {
    // dot product / (||a|| * ||b||)
}

// 事件:
// "/embeddings"
// "onnxruntime"
// "attention_mask" / "token_type_ids" (transformer 模型输入)
// "embedding_columns"
```

### 2.6 SemanticSearch — 语义搜索

```go
type SemanticSearch struct {
    store     *MemoryStore
    embedding *EmbeddingEngine
}

func (s *SemanticSearch) SearchMemory(query string, limit int) ([]SearchResult, error) {
    // 1. 生成 query embedding
    queryEmb := s.embedding.GenerateEmbedding(query)

    // 2. 在 SQLite 中搜索 (通过 embedding 列, 计算余弦相似度)
    // SQL (近似):
    // SELECT m.*, 
    //   (embedding_cosine_similarity(m.embedding, ?)) as score
    // FROM memory_chunks m
    // WHERE m.is_archived = 0 AND m.is_deleted = 0
    // ORDER BY score DESC
    // LIMIT ?

    // 3. 同时进行 FTS 全文搜索 (keyword match)
    // SELECT * FROM memory_fts WHERE memory_fts MATCH ?

    // 4. 合并结果 (semantic + keyword), 按加权分数排序
}

// 事件:
// "fts search: %w"
// "scan fts result: %w"
// "SemanticSearchActivitySessions"
// "semantically similar to %q"
```

---

## 模块 3: 执行层 (Solve)

### 3.1 AgentRunner — Agent 执行引擎

**目的**: 基于记忆和知识执行 LLM Agent 任务。

```go
type AgentRunner struct {
    llmClient    *LLMClient
    model        string            // "sonnet" / "gpt-4" / "haiku"
    systemPrompt string
    tools        []Tool
    memory       *MemoryStore
    mcpHub       *MCPHub
    sessionStore *SessionStore
}

type AgentRunConfig struct {
    SessionID       string
    SystemPrompt    string
    Model           string
    MaxTokens       int
    Temperature     float64
    Tools           []string
    MemoryAccess    bool              // 是否可访问记忆库
    ContextWindows  int               // 上下文窗口 (记忆数)
    EnableHandoff   bool
}

type AgentRunResult struct {
    SessionID    string
    Messages     []Message           // 完整对话历史
    ToolCalls    []ToolCall
    FinalOutput  string
    TokensUsed   int
    DurationMs   int64
    Error        string
}

// Agent 生命周期:
// 1. CreateSession(systemPrompt) → sessionID
// 2. SendPrompt(sessionID, userMessage) → streaming response
// 3. Agent 在回复中可以调用 tools (MCP 协议)
// 4. Agent 可以搜索记忆库 (MemoryAccess=true)
// 5. Agent 可以创建 handoff (委托给其他 agent)
// 6. StopPrompt(sessionID) → 中断
// 7. 会话持久化到 chat_sessions 表

// 事件:
// "agent:status" / "agent:events"
// "StartAgent" / "CancelStream" / "CloseCrystal"
// "RestartAgent"
// "sessions.db"
```

### 3.2 MCPHub — Model Context Protocol Hub

**目的**: 提供标准化的工具接口，支持外部 MCP 服务器。

```go
type MCPHub struct {
    servers   map[string]*MCPServer
    registry  *MCPRegistry
    client    *mcp.Client
}

type MCPServer struct {
    ID          string
    Name        string
    Description string
    Command     string              // 启动命令
    Args        []string
    Env         map[string]string
    IsEnabled   bool
    IsBuiltin   bool
    Tools       []MCPTool
    HealthStatus string            // "healthy", "unhealthy", "unknown"
}

type MCPRegistry struct {
    // 从 marketplace / awesome-mcp-servers 获取可用服务器列表
    SourceURLs  []string
    Servers     []MCPServerMetadata
}

// MCP 工具调用流程:
// 1. Client → POST /api/call {server, tool, arguments}
// 2. Hub 路由到对应 MCP 服务器
// 3. 执行工具调用
// 4. 返回结果

// 内置 MCP 工具:
// - filesystem: read_file, write_file, list_directory
// - browser: navigate, click, type, screenshot, eval
// - memory: search, get, create, update, delete
// - activity: query_sessions, query_snapshots
// - knowledge: search, get_card

// 事件:
// "mcp__" (MCP 协议前缀)
// "mcp.json" (MCP 配置文件)
// "Yansu-MCP-Hub"
// "registry.json"
// "mcp runtime not initialised"
// "modelcontextprotocol/servers"
// "punkpeye/awesome-mcp-servers"
```

### 3.3 CUADriver — Computer Use Automation

**目的**: 自动化操控桌面和浏览器。

```go
type CUADriver struct {
    browser    *rod.Browser    // go-rod 浏览器自动化
    axClient   *AXClient       // macOS Accessibility 客户端
    screenshot *ScreenCapture
    cuaTarget  *CuaDriverApp   // 原生 CUA Driver app
}

// CUA Driver App 通信:
// - cua-driver-bundle/CuaDriver.app (bundled 原生 macOS 应用)
// - 通过 Unix socket 通信
// - 支持: click, type, scroll, drag, hotkey, screenshot

// Computer Use API:
// POST /api/computer-use/see       → 截图 + OCR/AX 描述
// POST /api/computer-use/click     → 点击坐标
// POST /api/computer-use/type      → 键盘输入
// POST /api/computer-use/scroll    → 滚动
// POST /api/computer-use/hotkey    → 快捷键组合
// POST /api/computer-use/drag      → 拖拽
// POST /api/computer-use/open      → 打开应用
// POST /api/computer-use/windows   → 列出窗口
// POST /api/computer-use/paste     → 粘贴
// POST /api/computer-use/press     → 按键

// Browser API:
// POST /api/browser/open           → 打开 URL
// POST /api/browser/screenshot     → 页面截图
// POST /api/browser/click          → 点击元素
// POST /api/browser/type           → 输入文字
// POST /api/browser/read           → 读取页面内容
// POST /api/browser/eval           → 执行 JavaScript
// POST /api/browser/close          → 关闭标签
// POST /api/browser/go-off-screen  → 后台运行
// POST /api/browser/bring-to-front → 前置
// POST /api/browser/state          → 获取页面状态
// POST /api/browser/cdp            → Chrome DevTools Protocol

// 事件:
// "cua-driver" / "bundled-cua"
// "[cua-proxy] accept error: %v"
// "write cua-driver request: %w"
// "read cua-driver response: %w"
// "[cua-driver] daemon exited: %v"
// "marshal cua-driver request: %w"
// "computer_use"
```

### 3.4 CronScheduler — 定时任务调度

**目的**: 管理所有定时任务，是系统自动化的核心调度器。

```go
type CronScheduler struct {
    scheduler *cron.Cron          // robfig/cron/v3
    store     *CronStore
    notifier  *Notifier
}

type CronJobRow struct {
    ID              string
    Name            string
    Description     string
    Enabled         bool
    ScheduleKind    string    // "interval", "cron", "manual", "once"
    ScheduleConfig  string    // cron expression 或 interval 定义
    ScheduleEvidence string   // 调度证据 (上次运行上下文)
    TargetKind      string    // "agent", "summary", "pipeline", "cleanup", "crystallize"
    TargetConfig    string    // JSON 配置
    LastRunAt       *time.Time
    LastRunStatus   string
    NextRunAt       *time.Time
    RetryPolicy     string    // JSON: {max_retries, backoff}
    RetryRunAt      *time.Time
    DeleteAfterRuns *int      // 运行 N 次后自动删除
    FinishedAt      *time.Time
    DurationMs      int64
    CreatedAt       time.Time
    UpdatedAt       time.Time
}

// 内置定时任务:
// 1. daily_summary:      每日活动摘要 (自动生成)
// 2. weekly_summary:     每周报告
// 3. dream-archive:      记忆归档 (定期运行)
// 4. dream-merge:        记忆合并
// 5. memory-crystallizer: 定期结晶化新活动
// 6. dedup-check:        去重检查
// 7. pipeline-cleanup:   管道数据清理
// 8. meeting-summary:    会议后摘要生成
// 9. health-check:       系统健康检查
// 10. cache-prune:       缓存清理

// Cron API:
// GET    /api/cron/jobs        - 列出所有任务
// POST   /api/cron/jobs        - 创建任务
// PUT    /api/cron/jobs/:id    - 更新任务
// DELETE /api/cron/jobs/:id    - 删除任务
// POST   /api/cron/jobs/:id/run - 立即执行
// GET    /api/cron/runs        - 运行历史

// 事件:
// "cron:event" / "cron:run"
// "cron:state" / "cron:status"
// "CreateCronJob" / "UpdateCronJob" / "DeleteCronJob" / "RunCronJobNow"
// "ReorderJobs"
// "CRON_TZ=%s %s"
// "Scheduled: %s"
```

### 3.5 HandoffManager — 任务交接

```go
type HandoffManager struct {
    proposals map[string]*HandoffProposal
    agents    *AgentRegistry
}

type HandoffProposal struct {
    ID          string
    FromAgent   string       // 发起 agent
    ToAgent     string       // 目标 agent (空为自动匹配)
    Task        string       // 任务描述
    Context     string       // 上下文 (包含相关记忆引用)
    Priority    int
    Status      string       // "pending", "accepted", "rejected", "completed"
    SessionID   string       // 关联的 chat session
    CreatedAt   time.Time
    AcceptedAt  *time.Time
    CompletedAt *time.Time
    Result      string       // 执行结果
}

// Handoff 流程:
// 1. Agent A 执行中遇到需要其他能力完成的任务
// 2. Agent A 调用 CreateHandoffProposal
// 3. 系统评估: 匹配 Agent B 的能力与任务需求
// 4. Agent B 收到通知, 接受或拒绝
// 5. 接受后传递上下文 (相关 memory + knowledge)
// 6. Agent B 执行任务, 返回结果给 Agent A

// 事件:
// "Handoff: %s"
// "handoff"
// "handoff_prompt_columns"
// "handoff_pipeline_columns"
// "AcceptHandoffProposal"
// "DismissHandoffProposal"
// "sim-handoff-"
// "handoff_status"
```

### 3.6 SpotlightIntegration — 桌面快速入口

```go
type SpotlightIntegration struct {
    builder    *SpotlightBuilder
    suggester  *SuggestionEngine
    theme      *ThemeManager
}

// macOS Spotlight 集成:
// - 用户通过 Spotlight 快捷键 (Cmd+Space 或自定义) 触发
// - 显示 Yansu 的快速面板:
//   * Quick Chat (快速对话)
//   * Search Memory (搜索记忆)
//   * Voice Input (语音输入)
//   * Execute Command (执行命令)
//   * Build Deliverable (生成交付物)

// API:
// POST /api/spotlight/submit            - 提交查询/命令
// POST /api/spotlight/expand            - 展开结果
// POST /api/spotlight/cancel            - 取消
// POST /api/spotlight/suggestions       - 智能建议
// POST /api/spotlight/frontmost-app     - 获取前台应用
// POST /api/spotlight/theme             - 主题切换
// POST /api/spotlight/build-deliverable - 构建交付物 (从记忆生成文档)
// POST /api/spotlight/permission        - 权限状态
// POST /api/spotlight/voice/init        - 语音输入初始化
// POST /api/spotlight/voice/transcribe  - 语音转文字

// 事件:
// "spotlight_%d"
// "X-Yansu-Spotlight-Token"
// "pick spotlight port: %w"
```

---

### 1.8 IPC Hook —— Mac 客户端拦截方案

**目的**: 拦截没有公开 API 的桌面应用（微信/企业微信等），读取和发送消息。

#### 五层 IPC 方案（按 app 封闭程度递进）

```
App 越封闭 → 方案越底层
══════════════════════════════════════════════

方案 1: SQLite 直接读写   → 读本地数据库（最常用）
方案 2: HTTP API 代理      → 劫持 app 内部 API 调用
方案 3: AXUIElement 操作   → 通过 Accessibility API 读取/操控 UI
方案 4: CGEvent 私有字段    → bgclick-rev: 不抢焦点的点击
方案 5: NSDistributedNotification → 跨进程状态监听
```

#### 方案 1: SQLite Hook —— 读消息的主力

Mac 桌面客户端把聊天记录存在本地 SQLite 中：

```
微信:
  ~/Library/Containers/com.tencent.xinWeChat/
  └── Data/Library/Application Support/com.tencent.xinWeChat/
      └── <user_hash>/Message/msg_0.db, msg_1.db ...

企业微信:
  ~/Library/Containers/com.tencent.WeComMac/
  └── Data/Library/Application Support/WeCom/
      └── <corp_id>/Message/*.db

QQ:
  ~/Library/Containers/com.tencent.qq/
  └── Data/Library/Application Support/QQ/
      └── <uin>/msg.db

飞书/Lark:
  ~/Library/Application Support/Lark/
  └── <tenant>/message.db
```

**Yansu 的处理方式**:

```go
// 从二进制推断的 SQLite 读取策略
type WeChatDBReader struct {
    dbPath      string
    lastReadID  int64
    pollInterval time.Duration
}

func (r *WeChatDBReader) ReadNewMessages() ([]Message, error) {
    // 1. WAL 模式下直接读取（主 app 持有写锁，只读不需要锁）
    // 2. 如果遇到 SQLITE_BUSY:
    //    - 先尝试 WAL checkpoint: "PRAGMA wal_checkpoint(TRUNCATE)"
    //    - 如果仍失败: copy 数据库文件到 temp 目录读取
    // 3. 解析消息表结构 (微信 msg 表):
    //    - CreateTime, Message, Type, Des, ImgStatus, MesLocalID...
    // 4. 过滤已处理的消息 (MesLocalID > lastReadID)
    // 5. 转换格式: 文本/图片/语音/视频/系统消息
}

// 关键事件:
// "no WeChat credentials"          → 未找到微信数据库
// "rewrite %s: %w"                 → 复制数据库文件
// "[语音消息，暂不支持解析]"        → Voice msg not supported
// "[视频消息，暂不支持解析]"        → Video msg not supported  
// "[图片下载失败: %v]"             → Image download failed
```

#### 方案 2: HTTP API 代理 —— 发送消息

微信 Mac 客户端内部通过 iLink API 与微信服务器通信。Yansu 通过重建这些 HTTP 请求来收发消息：

```
微信 iLink API 端点 (从二进制提取):
  ilinkai.weixin.qq.com/ilink/bot/getupdates       → 轮询新消息
  ilinkai.weixin.qq.com/ilink/bot/sendmessage      → 发送消息
  ilinkai.weixin.qq.com/ilink/bot/sendtyping       → 发送"正在输入"
  ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode   → 获取 bot 二维码
  ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status → 扫码状态

微信 CDN (文件上传):
  novac2c.cdn.weixin.qq.com/c2c                    → C2C 文件上传
  CDN upload status %d: %s                          → 上传状态
  encrypted_query_param=                             → 加密参数

Yansu wechat-daemon 架构:
  ┌──────────────────────────────────┐
  │   wechat-daemon (goroutine)      │
  │                                  │
  │  1. 从 SQLite 读取 bot token     │
  │  2. 构造 iLink HTTP 请求          │
  │  3. 处理加密参数                  │
  │  4. 发送消息 / 轮询新消息         │
  │  5. 写入 Activity Pipeline       │
  └──────────────────────────────────┘

关键事件:
  "[wechat] monitor started for bot %s"
  "[wechat] monitor stopped"
  "[wechat] routing message to AgentRunner from %s"
  "[wechat-api] %s %s error: %v"
  "[wechat-api] sendmessage (file): %s"
  "[wechat] sendTyping error: %v"
  "parse sendmessage: %w"
  "CDN response exceeds %d bytes"
```

#### 方案 3: AXUIElement API —— 通用 UI 级拦截

当 SQLite 或 API 不可用时，通过 Accessibility API：

```go
// objc class list 中提取的 AX 调用:
AXUIElementCreateApplication(pid)                    // 连接目标 app
AXUIElementCopyAttributeValue(elem, attr, &value)    // 读取 UI 属性
  // kAXRoleAttribute              → button, text, staticText...
  // kAXTitleAttribute             → 窗口/按钮标题
  // kAXValueAttribute             → 文本内容
  // kAXSelectedTextAttribute      → 选中文本
  // kAXChildrenAttribute          → 子元素树
  // kAXFocusedUIElementAttribute  → 焦点元素
AXUIElementCopyElementAtPosition(x, y, &element)     // 坐标查找元素
AXUIElementPerformAction(element, action)            // 执行操作
  // kAXPressAction, kAXConfirmAction, kAXShowMenuAction...
AXUIElementSetAttributeValue(element, attr, value)   // 设置值
AXUIElementSetMessagingTimeout(timeout)              // 超时
AXObserverCreate(pid, callback, &observer)           // 监听 UI 变化
AXObserverGetRunLoopSource(observer)                 // 获取事件源

// 关键注释（从二进制提取）:
// "All paths are focus-safe: AX clicks dispatch via AXUIElementPerformAction,
//  pixel clicks dispatch via bgclick-rev so raw {pid,x,y} no longer steals focus."
```

#### 方案 4: bgclick-rev —— 私有的 CGEvent 绕过

对于无法通过 AX 完成的操作（如某些 app 屏蔽了 Accessibility），Yansu 使用 CGEvent 私有字段：

```go
// 符号表中提取的 CGEvent 调用:
CGEventCreateKeyboardEvent(source, keycode, keyDown)
CGEventCreateMouseEvent(source, mouseType, position, button)
CGEventCreateScrollWheelEvent(source, scrollType, axis, value)
CGEventGetFlags(event)
CGEventGetIntegerValueField(event, field)
CGEventGetLocation(event)
CGEventKeyboardGetUnicodeString(event, ...)
CGEventPostToPid(pid, event)   // 直接投递给目标进程!

// bgclick-rev 原理（推断）:
// 正常的 CGEvent 通过 WindowServer 会激活目标窗口（抢焦点）
// bgclick-rev 设置私有字段:
//   kCGEventTargetProcessID     → 目标 PID
//   kCGEventSourceUserData      → 绕过窗口激活标记
//   可能的私有 field: 0x13 (kCGEventTargetProcessID)
//   可能的私有 field: 0x1D (事件不激活标记)
// 然后通过 CGEventPostToPid 直接发送,完全绕过焦点系统
//
// 这样 Yansu 可以在后台静默操作其他 app 而不被用户感知
```

#### 方案 5: NSDistributedNotificationCenter

macOS 系统级跨进程通知监听：

```go
// objc class list 包含:
NSDistributedNotificationCenter
  - addObserver:selector:name:object:
  - postNotificationName:object:userInfo:

// 常见用途:
// - 检测 app 启动/退出
// - 监听剪贴板变化
// - 接收其他 app 发出的通知
```

#### 平台集成总览

| 平台 | 读消息 | 发消息 | 文件 | 难度 |
|------|--------|--------|------|------|
| **微信** | SQLite msg.db + iLink API polling | iLink HTTP API | CDN upload | **高** |
| **企业微信** | SQLite + Open API SDK | Open API | Open API | 中 |
| **飞书/Lark** | Open API SDK (`larksuite/oapi-sdk-go`) | Open API | Open API | 低 |
| **QQ** | SQLite msg.db + HTTP API | HTTP API | 无 CDN 访问 | 中 |
| **钉钉** | 无公开 API, 仅 AX 回退 | AX 模拟输入 | 无 | **高** |
| **Slack** | WebSocket RTM / Events API | Web API | files.upload | 低 |
| **Discord** | WebSocket Gateway | REST API | REST API | 低 |
| **Telegram** | Bot API long polling | Bot API | Bot API | 低 |
| **Teams** | Graph API (`/me/messages`) | Graph API | Graph API | 低 |
| **RingCentral** | REST API | REST API | REST API | 低 |

---

## 模块 4: 通信架构

### 4.1 进程间通信

```
┌─────────────────────────────────────────┐
│            Wails GUI (React)             │
│            localhost:34116 (dev)         │
│            embedded dist (prod)          │
├─────────────────────────────────────────┤
│       Wails IPC (window.wails.Callback)  │
├─────────────────────────────────────────┤
│              Go Backend                   │
│                                           │
│  ┌─────────────┐  ┌──────────────┐      │
│  │ GUI Daemon   │  │ Cron API      │      │
│  │ (HTTP/WS)    │  │ Server        │      │
│  └──────┬──────┘  └──────┬───────┘      │
│         │                │               │
│  ┌──────┴────────────────┴──────┐       │
│  │    Daemon Socket (.sock)      │       │
│  │    IPC: CLI ⇄ GUI Daemon      │       │
│  └──────────────────────────────┘       │
│                                           │
│  ┌───────────────────────────────────┐  │
│  │      External Daemons              │  │
│  │  - slack-scan                      │  │
│  │  - discord-scan                    │  │
│  │  - telegram-daemon                 │  │
│  │  - wechat-daemon                   │  │
│  │  - feishu-scan                     │  │
│  │  - teams-scan                      │  │
│  │  - cua-driver                      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 4.2 CLI 工具 (yansu-cli-bundle/bin/yansu)

```
CLI 命令 (推断):
  yansu daemon start        - 启动后台守护进程
  yansu daemon stop         - 停止守护进程
  yansu daemon status       - 查看状态
  yansu activity list       - 列出活动会话
  yansu activity snapshot   - 立即截图
  yansu memory search <q>   - 搜索记忆
  yansu memory stats        - 记忆统计
  yansu agent chat          - 快速对话
  yansu cron list           - 列出定时任务
  yansu cron run <id>       - 执行定时任务
  yansu crystal list        - 列出 Crystal 应用
  yansu crystal install     - 安装 Crystal
  yansu config get/set      - 配置管理
  yansu doctor              - 诊断检查
```

---

## 模块 5: 数据库设计

### 5.1 完整 DDL

```sql
-- ============================================================
-- Activity 相关
-- ============================================================

CREATE TABLE activity_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    front_app TEXT,
    title TEXT,
    segment_count INTEGER DEFAULT 0,
    snapshot_count INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    is_meeting INTEGER DEFAULT 0,
    meeting_title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_sessions_start ON activity_sessions(start_time);
CREATE INDEX idx_activity_sessions_meeting ON activity_sessions(is_meeting);

CREATE TABLE activity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES activity_sessions(id),
    timestamp DATETIME NOT NULL,
    image_data BLOB,
    image_hash TEXT,
    image_size_bytes INTEGER,
    is_closed_eyes INTEGER DEFAULT 0,
    front_app TEXT,
    browser_url TEXT,
    window_title TEXT,
    ax_tree_json TEXT,
    ocr_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshots_session ON activity_snapshots(session_id);
CREATE INDEX idx_snapshots_timestamp ON activity_snapshots(timestamp);
CREATE INDEX idx_snapshots_hash ON activity_snapshots(image_hash);

CREATE TABLE activity_ocr_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER REFERENCES activity_snapshots(id) ON DELETE CASCADE,
    text_content TEXT NOT NULL,
    ocr_status TEXT DEFAULT 'pending',
    embedding TEXT,
    ocr_duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ocr_snapshot ON activity_ocr_frames(snapshot_id);
CREATE INDEX idx_ocr_status ON activity_ocr_frames(ocr_status);

CREATE VIRTUAL TABLE activity_ocr_fts USING fts5(
    text_content,
    content='activity_ocr_frames',
    content_rowid='id'
);

CREATE TABLE activity_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES activity_sessions(id),
    start_snapshot_id INTEGER REFERENCES activity_snapshots(id),
    end_snapshot_id INTEGER REFERENCES activity_snapshots(id),
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    segment_type TEXT,
    front_app TEXT,
    title TEXT,
    summary TEXT,
    embedding TEXT,
    participant_count INTEGER DEFAULT 0,
    is_crystallized INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_segments_session ON activity_segments(session_id);
CREATE INDEX idx_segments_type ON activity_segments(segment_type);
CREATE INDEX idx_segments_crystallized ON activity_segments(is_crystallized);

CREATE TABLE activity_pipeline_runs (
    id TEXT PRIMARY KEY,
    session_id INTEGER REFERENCES activity_sessions(id),
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    status TEXT DEFAULT 'running',
    stage TEXT DEFAULT 'collection',
    error_message TEXT,
    snapshot_ids TEXT,
    segment_ids TEXT,
    snapshots_count INTEGER DEFAULT 0,
    segments_count INTEGER DEFAULT 0,
    triage_results TEXT,
    summary_results TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pipeline_status ON activity_pipeline_runs(status);
CREATE INDEX idx_pipeline_session ON activity_pipeline_runs(session_id);

-- ============================================================
-- Memory / Knowledge 相关
-- ============================================================

CREATE TABLE memory_chunks (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    summary TEXT,
    tokens INTEGER DEFAULT 0,
    embedding BLOB,
    embedding_dim INTEGER DEFAULT 768,
    source_type TEXT NOT NULL,
    source_id TEXT,
    source_platform TEXT,
    chunk_index INTEGER DEFAULT 0,
    timestamp DATETIME NOT NULL,
    is_archived INTEGER DEFAULT 0,
    is_merged INTEGER DEFAULT 0,
    merged_into TEXT,
    access_count INTEGER DEFAULT 0,
    last_accessed DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_memory_timestamp ON memory_chunks(timestamp);
CREATE INDEX idx_memory_source ON memory_chunks(source_type);
CREATE INDEX idx_memory_archived ON memory_chunks(is_archived);
CREATE INDEX idx_memory_merged ON memory_chunks(is_merged);

CREATE TABLE memory_fts (
    id INTEGER PRIMARY KEY,
    content TEXT,
    summary TEXT
);

CREATE VIRTUAL TABLE memory_fts_idx USING fts5(
    content, summary,
    content='memory_fts',
    content_rowid='id'
);

CREATE TABLE knowledge (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    dimension TEXT,
    confidence REAL DEFAULT 1.0,
    source_chunks TEXT,
    tags TEXT,
    version INTEGER DEFAULT 1,
    is_deleted INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_knowledge_dimension ON knowledge(dimension);
CREATE INDEX idx_knowledge_deleted ON knowledge(is_deleted);
CREATE INDEX idx_knowledge_pinned ON knowledge(is_pinned);

CREATE TABLE knowledge_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id TEXT REFERENCES knowledge(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    dimension TEXT,
    confidence REAL,
    tags TEXT,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kv_knowledge ON knowledge_versions(knowledge_id);

CREATE TABLE knowledge_files (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT REFERENCES knowledge(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER,
    file_path TEXT,
    is_embedded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE memory_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT REFERENCES memory_chunks(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    dimension INTEGER DEFAULT 768
);

CREATE INDEX idx_memory_embedding ON memory_index(embedding);

-- ============================================================
-- Dream 相关
-- ============================================================

CREATE TABLE dream_runs (
    id TEXT PRIMARY KEY,
    run_type TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    input_chunks INTEGER DEFAULT 0,
    output_chunks INTEGER DEFAULT 0,
    merged_count INTEGER DEFAULT 0,
    deleted_count INTEGER DEFAULT 0,
    config_json TEXT,
    result_json TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Cron 相关
-- ============================================================

CREATE TABLE cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    schedule_kind TEXT NOT NULL,
    schedule_config TEXT NOT NULL,
    schedule_evidence TEXT,
    target_kind TEXT NOT NULL,
    target_config TEXT NOT NULL,
    last_run_at DATETIME,
    last_run_status TEXT,
    last_run_duration_ms INTEGER,
    next_run_at DATETIME,
    retry_policy TEXT,
    retry_run_at DATETIME,
    delete_after_runs INTEGER,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cron_next_run ON cron_jobs(next_run_at);
CREATE INDEX idx_cron_enabled ON cron_jobs(enabled);
CREATE INDEX idx_cron_kind ON cron_jobs(schedule_kind);

CREATE TABLE cron_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES cron_jobs(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'running',
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_ms INTEGER,
    result_json TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cron_runs_job ON cron_runs(job_id);
CREATE INDEX idx_cron_runs_status ON cron_runs(status);

-- ============================================================
-- Agent / Chat 相关
-- ============================================================

CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    model TEXT,
    system_prompt TEXT,
    total_tokens INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    crystal_name TEXT,
    workspace_id TEXT,
    is_archived INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_updated ON chat_sessions(updated_at);
CREATE INDEX idx_chat_crystal ON chat_sessions(crystal_name);

CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_results TEXT,
    tokens_used INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- ============================================================
-- Handoff 相关
-- ============================================================

CREATE TABLE handoffs (
    id TEXT PRIMARY KEY,
    from_session_id TEXT REFERENCES chat_sessions(id),
    to_session_id TEXT REFERENCES chat_sessions(id),
    task_description TEXT NOT NULL,
    context_json TEXT,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME,
    completed_at DATETIME
);

CREATE INDEX idx_handoffs_status ON handoffs(status);

-- ============================================================
-- Crystal 相关
-- ============================================================

CREATE TABLE crystals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT,
    entry_html TEXT,
    icon_svg TEXT,
    source_path TEXT,
    manifest_json TEXT,
    is_builtin INTEGER DEFAULT 0,
    is_enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Project / Workspace 相关
-- ============================================================

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    workspace_id TEXT REFERENCES workspaces(id),
    repo_url TEXT,
    worktree_path TEXT,
    git_branch TEXT,
    git_commit TEXT,
    sort_order INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_projects_workspace ON projects(workspace_id);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- MCP / Skills 相关
-- ============================================================

CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    command TEXT,
    args TEXT,
    env TEXT,
    is_enabled INTEGER DEFAULT 1,
    is_builtin INTEGER DEFAULT 0,
    health_status TEXT DEFAULT 'unknown',
    last_health_check DATETIME,
    install_source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    version TEXT,
    source_path TEXT,
    install_source TEXT,
    is_enabled INTEGER DEFAULT 1,
    is_bundled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SOUL / 长期记忆文件
-- ============================================================

CREATE TABLE soul_files (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    file_path TEXT,
    source_type TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 系统配置
-- ============================================================

CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT DEFAULT 'string',
    description TEXT,
    is_secret INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 迁移日志
-- ============================================================

CREATE TABLE migration_log (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 模块 6: API 设计

### 6.1 REST API

```
Base: http://localhost:{port}

# Health
GET    /api/health                             → {"status":"ok","version":"0.1.290"}
GET    /api/version                            → {"version":"0.1.290","commit":"e5e66a6"}

# Activity
GET    /api/activity/sessions                  → [ActivitySession]
GET    /api/activity/session/:id               → ActivitySessionDetail
GET    /api/activity/session/:id/snapshots     → [ActivitySnapshot]
GET    /api/activity/snapshot/:id              → ActivitySnapshotDetail
GET    /api/activity/snapshot/:id/ocr          → OCRResult
GET    /api/activity/pipeline/runs             → [ActivityPipelineRun]
GET    /api/activity/segment/:id               → ActivitySegment
GET    /api/activity/monitor-status            → MonitorStatus
GET    /api/activity/storage-stats             → StorageStats
POST   /api/activity/frame                     → 上传单帧
POST   /api/activity/pipeline/run              → 触达管道运行

# Memory
GET    /api/memory/list?offset=0&limit=50      → [MemoryChunk]
GET    /api/memory/show/:id                    → MemoryChunkDetail
POST   /api/memory/search                      → [SearchResult]
POST   /api/memory/create                      → MemoryChunk
PUT    /api/memory/:id                         → MemoryChunk
DELETE /api/memory/:id                         → ok
GET    /api/memory/status                      → MemoryStats
POST   /api/memory/crystallize                 → 触达结晶化
GET    /api/memory/dream-runs                  → [DreamRun]
POST   /api/memory/dream/start                 → 启动 Dream

# Knowledge
GET    /api/knowledge/list                     → [KnowledgeCard]
GET    /api/knowledge/:id                      → KnowledgeCardDetail
POST   /api/knowledge/create                   → KnowledgeCard
PUT    /api/knowledge/:id                      → KnowledgeCard
DELETE /api/knowledge/:id                      → ok
GET    /api/knowledge/versions/:id             → [KnowledgeVersion]
POST   /api/knowledge/version/:id/restore      → 恢复到指定版本
GET    /api/knowledge/:id/files                → [KnowledgeFile]

# Agent
POST   /api/start-agent                        → {session_id}
POST   /api/send-prompt                        → streaming SSE
POST   /api/stop-prompt                        → ok
POST   /api/restart-agent                      → ok
GET    /api/agent/status                       → AgentStatus

# Cron
GET    /api/cron/jobs                          → [CronJob]
POST   /api/cron/jobs                          → CronJob
PUT    /api/cron/jobs/:id                      → CronJob
DELETE /api/cron/jobs/:id                      → ok
POST   /api/cron/jobs/:id/run                  → 立即执行
GET    /api/cron/runs                          → [CronRun]

# MCP
GET    /api/mcp/sources                        → 可用 MCP 源列表
POST   /api/mcp/install                        → 安装 MCP 服务器
GET    /api/mcp/discover                       → 发现 MCP 服务器
GET    /api/mcp/registry                       → MCP 注册表
POST   /api/call                               → MCP 工具调用

# CUA (Computer Use Automation)
POST   /api/computer-use/see                   → 截图+描述
POST   /api/computer-use/click                 → 点击
POST   /api/computer-use/type                  → 输入
POST   /api/computer-use/scroll                → 滚动
POST   /api/computer-use/hotkey                → 快捷键
POST   /api/computer-use/drag                  → 拖拽
POST   /api/computer-use/open                  → 打开应用
POST   /api/computer-use/windows               → 窗口列表
POST   /api/computer-use/paste                 → 粘贴
POST   /api/computer-use/press                 → 按键

# Browser
POST   /api/browser/open                       → 打开 URL
POST   /api/browser/screenshot                 → 页面截图
POST   /api/browser/click                      → 点击元素
POST   /api/browser/type                       → 输入
POST   /api/browser/read                       → 读取页面
POST   /api/browser/eval                       → 执行 JS
POST   /api/browser/close                      → 关闭标签
POST   /api/browser/state                      → 页面状态
POST   /api/browser/cdp                        → CDP 原始命令

# Communication
POST   /api/slack/send                         → 发送 Slack 消息
POST   /api/slack/send-with-image              → 发送图片
POST   /api/discord/send                       → 发送 Discord 消息
POST   /api/discord/send-with-image            → 发送图片
POST   /api/telegram/send-dm                   → 发送 Telegram DM
POST   /api/feishu/send                        → 发送飞书消息
GET    /api/slack/channels                     → 列出 Slack 频道
GET    /api/discord/guilds                     → 列出 Discord 服务器
GET    /api/telegram/groups                    → 列出 Telegram 群组

# Workspace / Git
GET    /api/workspace/list                     → [Workspace]
POST   /api/workspace/save                     → Workspace
DELETE /api/workspace/:id                      → ok
GET    /api/projects                           → [Project]
POST   /api/project/save                       → Project
DELETE /api/project/:id                        → ok
GET    /api/git-info                           → Git 仓库信息
POST   /api/git/stage                          → Git stage 文件
POST   /api/git/commit                         → Git commit
POST   /api/git/clone                          → Git clone

# SSH / Terminal
POST   /api/ssh/connect                        → SSH 连接
POST   /api/ssh/disconnect                     → SSH 断开
POST   /api/terminal/create                    → 创建终端
POST   /api/terminal/close                     → 关闭终端

# Skills
GET    /api/skills                             → 已安装 skills
POST   /api/skills/install                     → 安装 skill
DELETE /api/skills/:id                         → 卸载 skill
GET    /api/skills/sources                     → Skill 源列表

# UI
GET    /api/ui-state/load                      → UI 状态
POST   /api/ui-state/save                      → 保存 UI 状态
POST   /api/open-url                           → 打开 URL
POST   /api/open-path                          → 打开文件路径
POST   /api/clipboard/write                    → 写入剪贴板

# Spotlight
GET    /api/spotlight/suggestions              → 建议
GET    /api/spotlight/frontmost-app            → 前台应用
POST   /api/spotlight/submit                   → 提交查询
POST   /api/spotlight/expand                   → 展开结果
POST   /api/spotlight/cancel                   → 取消
POST   /api/spotlight/build-deliverable        → 生成交付物
GET    /api/spotlight/permission               → 权限状态
POST   /api/spotlight/voice/init               → 语音输入开始
POST   /api/spotlight/voice/transcribe         → 语音转文字

# Subscription / User
GET    /api/users/me                           → 用户信息
GET    /api/users/me/subscription              → 订阅信息
POST   /api/users/me/subscription/checkout     → 开始订阅
POST   /api/users/me/subscription/portal       → 管理订阅
POST   /api/auth/logout                        → 登出

# Data Export
GET    /api/data/v1/get                        → 导出数据
```

### 6.2 WebSocket API

```
ws://localhost:{port}/api/daemon/ws

消息帧格式:
{
  "type": "event_type",
  "data": {},
  "timestamp": "2024-01-01T00:00:00Z"
}

事件类型:
  agent:status           - Agent 状态变更
  agent:stream_token      - LLM 流式 token
  agent:tool_call         - Agent 调用工具
  agent:tool_result       - 工具返回结果
  activity:new_snapshot   - 新快照
  activity:segment_done   - 分段完成
  activity:pipeline_done  - 管道处理完成
  cron:job_started        - 任务开始
  cron:job_completed      - 任务完成
  cron:job_failed         - 任务失败
  meeting:detected        - 检测到会议
  meeting:transcript_update - 会议转录更新
  memory:crystallized     - 记忆结晶完成
  memory:dream_completed  - Dream 完成
  notification            - 系统通知
  error                   - 错误
```

---

## 模块 8: 模型清单

### 8.1 本地 ONNX 模型（4 个）

所有本地模型通过 **ONNX Runtime 1.24.4** (`libonnxruntime.1.24.4.dylib`) 推理。

| 模型 | 文件 | 大小 | 用途 | 来源 |
|------|------|------|------|------|
| **SenseVoice ASR** | `model.int8.onnx` | ~100MB | 多语言语音识别 (zh/en/ja/ko/yue) | Sherpa-ONNX, int8 量化 |
| **Silero VAD** | `silero_vad.onnx` | ~1MB | 语音活动检测，分割语音段 | Sherpa-ONNX |
| **GLiNER PII** | `gliner-pii-basemodel_fp16.onnx` | ~200MB | PII 命名实体识别 (人名/邮箱/电话/信用卡...) | GLiNER, fp16 |
| **OCR** | `model.onnx` | ~20MB | 截图文字提取 | 本地 ONNX 推理 |

**下载源**（可配置，有 CDN 备份）：

```bash
# ASR 模型（默认 HummingFace）
YANSU_SHERPA_SENSE_VOICE_MODEL_URL=
  "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx"

# ASR token 文件
YANSU_SHERPA_SENSE_VOICE_TOKENS_URL=
  "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt"

# VAD 模型
YANSU_SHERPA_SILERO_VAD_URL=
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"

# CDN 备份（生产环境使用）
# https://model-assets.yansu.app/sherpa/model.int8.onnx
# https://model-assets.yansu.app/sherpa/silero_vad.onnx
# https://model-assets.yansu.app/sherpa/tokens.txt
```

**语言配置**:

```bash
# ASR 语言设置
YANSU_SHERPA_LANGUAGE          # 单语言模式 (如 "zh", "en", "auto")
YANSU_SHERPA_ALLOWED_LANGS     # 多语言白名单 (如 "zh,en,ja,ko,yue")

# Sherpa 库本身支持的完整语言列表:
# SHERPA_LANGUAGE → auto/zh/en/ja/ko/yue/de/fr/es/pt/it/ru...
```

**Sherpa-ONNX Go SDK 调用链**:

```go
// 从二进制符号表提取的完整 API:
SherpaOnnxCreateOfflineRecognizer(&config)          // 创建识别器
SherpaOnnxCreateCircularBuffer(size)                // 环形缓冲
SherpaOnnxCircularBufferPush(buffer, samples)        // 推送音频
SherpaOnnxCircularBufferGet(buffer, start, n)        // 获取音频段
SherpaOnnxCircularBufferPop(buffer, n)              // 弹出已处理
SherpaOnnxAcceptWaveformOffline(rec, samples, n)     // 送入音频
SherpaOnnxDecodeOffline(rec)                        // 解码

// VAD
SherpaOnnxCreateVoiceActivityDetector(&config)
SherpaOnnxVoiceActivityDetectorAcceptWaveform(vad, samples)

// 说话人嵌入
SherpaOnnxCreateSpeakerEmbeddingExtractor(&config)
SherpaOnnxCreateSpeakerEmbeddingManager(dim)
SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(ext, samples)
SherpaOnnxSpeakerEmbeddingManagerAdd(manager, embedding, speakerName)
SherpaOnnxSpeakerEmbeddingManagerSearch(manager, embedding, threshold)

// 音频标记
SherpaOnnxCreateAudioTagging(&config)
SherpaOnnxAudioTaggingCompute(tagger, samples)
SherpaOnnxAudioTaggingCreateOfflineStream(tagger)

// 标点恢复
SherpaOfflinePunctuationAddPunct(text)
SherpaOfflinePunctuationFreeText(text)

// 语音去噪
SherpaOnnxCreateOfflineSpeechDenoiser(&config)
SherpaOnnxCreateOnlineSpeechDenoiser(&config)
```

### 8.2 Whisper 备选 ASR

Yansu 也包含对 **Whisper** 的支持（作为备选或兼容方案）：

```go
// Whisper 相关结构体和方法:
WhisperModelConfig            // 模型配置
WhisperServerRunning          // 服务器状态
WhisperState                  // 运行时状态
  - WhisperStart              // 启动
  - WhisperDone               // 完成
  - WhisperErrors             // 错误计数
  - WhisperInFlight           // 当前处理中
  - WhisperLastMs             // 最近耗时
  - WhisperP50Ms / WhisperP95Ms  // 延迟分位数
  - WhisperRequests           // 请求计数
  - WhisperAcceptedTranscripts  // 接受的转录
  - WhisperEmptyTranscripts     // 空的转录
  - WhisperDroppedTranscripts   // 丢弃的转录

// whisper.cpp 通过子进程调用
// whisper-bundle/bin/whisper (bundled)
// whisper/bin/whisper-server  (HTTP API)
```

### 8.3 LLM 模型

#### 模型路由表

| 用途 | 默认模型 | 备选模型 | provider |
|------|---------|---------|----------|
| **Triage** (活动分类) | `claude-haiku-4-5` | `gpt-4` | anthropic / openai |
| **Crystallize** (日常) | `claude-haiku-4-5` | `gpt-4` | anthropic / openai |
| **Deep Crystallize** (重要) | `claude-sonnet-4-6` | `gpt-5` | anthropic / openai |
| **Dream Merge** (合并记忆) | `claude-sonnet-4-6` | `gpt-5` | anthropic / openai |
| **Agent Default** | `claude-sonnet-4-6` | `gpt-5` | anthropic / openai |
| **Daily Summary** | `claude-haiku-4-5` | `gpt-4` | anthropic / openai |
| **Weekly Summary** | `claude-sonnet-4-6` | `gpt-5` | anthropic / openai |

#### 支持的模型列表

```
Anthropic (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL):
  claude-haiku-4-5-20251001
  claude-sonnet-4-6
  claude-opus-4-6
  claude-opus-4-7

OpenAI (OPENAI_API_KEY):
  gpt-4
  gpt-5
  gpt-5.1-codex-mini
  gpt-5.2-codex (GPT-5.2 Codex)
  gpt-5.3-codex (GPT-5.3 Codex)
  gpt-5.4

Ollama (本地, ollama serve):
  llama / 任意拉取的模型

OpenAI Compatible (OPENAI_BASE_URL):
  任意兼容 OpenAI API 的模型
```

#### LLM Client 架构

```go
type LLMClient struct {
    providers map[string]ModelProvider  // "anthropic", "openai", "ollama"
}

type ModelProvider interface {
    ChatCompletion(ctx, ChatRequest) (*ChatResponse, error)
    ChatCompletionStream(ctx, ChatRequest) (<-chan ChatChunk, error)
    ListModels() ([]Model, error)
}

// 模型选择策略:
// 1. 用户配置优先 (settings.json 中的模型选择)
// 2. 环境变量回退:
//    ANTHROPIC_API_KEY → 使用 Claude 系列
//    OPENAI_API_KEY    → 使用 GPT 系列
//    OLLAMA_HOST       → 使用本地 Ollama
// 3. 任务类型自动选择:
//    fast/cheap  → haiku / gpt-4
//    quality     → sonnet / gpt-5
//    premium     → opus / gpt-5.4

// 不同任务的 config 覆盖:
type ModelConfig struct {
    TriageModel          string  // YANSU_TRIAGE_MODEL
    CrystallizeModel     string  // YANSU_CRYSTALLIZE_MODEL
    DeepAnalysisModel    string  // YANSU_DEEP_ANALYSIS_MODEL  
    DreamModel           string  // YANSU_DREAM_MODEL
    AgentDefaultModel    string  // YANSU_AGENT_MODEL
    SummaryModel         string  // YANSU_SUMMARY_MODEL
}

// 特殊的模型路由（从二进制提取）:
// "openai-memgen" provider:
//   - 用于 memory generation 的特殊路由
//   - HTTP header: X-OpenAI-Memgen-Request: true
//   - 禁用了所有非必要功能 (no MCP, no plugins, no web search)
//   - 用于 codex exec 子进程调用时的极简配置
```

#### LLM 上下文窗口覆盖

```bash
# 环境变量
YANSU_CONTEXT_WINDOW_OVERRIDE=200000   # 覆盖默认上下文窗口大小
ANTHROPIC_CONTEXT_WINDOW=200000        # Anthropic 特定
```

### 8.4 Embedding 模型

```
本地模型 (ONNX):
  embedding.model / model_fp16.onnx
  - 用途: memory chunk vector embedding
  - 维度: 768 (典型 BERT-like)
  - 距离: Cosine similarity

可选云端 API:
  - OpenAI text-embedding-3-small / large
  - 通过 OPENAI_API_KEY 自动切换
```

### 8.5 模型下载与缓存

```go
// 内部包: wails-gui/internal/onnxdl
// 模型下载管理

type ModelDownloader struct {
    modelDir    string   // ~/Library/Application Support/Yansu/models/
    manifestURL string   // https://model-assets.yansu.app/manifest.json
}

// 下载策略:
// 1. 检查本地缓存 (modelDir)
// 2. 优先从 CDN 下载 (model-assets.yansu.app)
// 3. 回退到原始源 (HuggingFace / GitHub Releases)
// 4. 校验文件完整性 (SHA256)
// 5. 首次启动时后台下载

// 事件:
// "create model dir: %w"
// "ensure pii model: %w"
// "model smoke test: %w"
// "[pii] failed to remove stale model %s: %v"
// "onnxdl" / "onnxdl.onnxdl"
```

---

## 模块 9: PII 与隐私过滤管道

### 9.1 概述

Yansu 在多个阶段实施隐私保护，包括：
1. **屏幕捕获阶段**：隐私窗口排除
2. **OCR 后处理阶段**：PII 文字检测与掩码
3. **存储阶段**：breadcrumb 审计追踪
4. **导出阶段**：redaction 脱敏

### 9.2 GLiNER PII 模型

**模型**: `gliner-pii-basemodel_fp16.onnx` (GLiNER = Generalist and Lightweight model for Named Entity Recognition)

```
来源: knowledgator/gliner-pii-base-v1.0 (HuggingFace)
推理: ONNX Runtime fp16
输入: text + entity type labels
输出: 实体位置 + 类型 + 置信度

检测的 PII 类型:
  - person          (人名)
  - email           (邮箱)
  - phone_number    (电话号码)
  - credit_card     (信用卡号)
  - password        (密码)
  - api_key         (API 密钥)
  - access_token    (访问令牌)
  - ssn             (社保号 / 身份证号)
  - passport        (护照号)
  - address         (地址)
  - bank_account    (银行账号)
  - driver_license  (驾照号)
```

### 9.3 PII 包结构

```go
// 从 Go 符号表提取的内部包结构:
wails-gui/internal/pii/              // PII 主包
  ├── detector/                      // PII 检测器
  │   ├── ensurePIIModel()           // 确保模型已下载
  │   ├── PIIModel                   // GLiNER ONNX 模型
  │   ├── detect(text) → []Entity
  │   └── detector ready (entities=N)
  ├── mask/                          // 掩码处理
  │   ├── fullBlur()                 // 全模糊
  │   ├── regionBlur()               // 区域模糊
  │   └── [pii-mask] write failed
  ├── regex/                         // 正则表达式回退
  │   ├── 信用卡: \b(?:\d[ -]*?){13,19}\b
  │   ├── 邮箱: 标准 email regex
  │   └── 电话: 多国格式匹配
  ├── tokenizer/                     // PII Tokenizer (分词器)
  │   ├── tokenizer.json / Vocab
  │   ├── [pii] output tensor
  │   └── words_mask tensor
  ├── text_redact/                   // 文本脱敏
  │   └── 将检测到的 PII 替换为 [REDACTED:type]
  └── sensitive_apps/                // 敏感应用管理
      ├── AddSensitiveApp()
      ├── RemoveSensitiveApp()
      ├── GetSensitiveApps()
      └── sensitive_apps 配置
```

### 9.4 PII 管道流程

```
OCR Text / Chat Message / Transcript
       │
       ▼
┌──────────────────────────────────┐
│  Stage 1: GLiNER PII Detection   │
│  ─────────────────────────────   │
│  - ONNX 推理 (fp16)               │
│  - 检测实体: person/email/phone/   │
│    credit_card/password/api_key   │
│  - 输出: [(start, end, type, conf)]│
│  Breadcrumb:                       │
│  "[pii] GLiNER detector ready     │
│        (entities=%d)"              │
│  "[ocr] breadcrumb start          │
│        call_id=%d source=pii-mask │
│        priority=%s"                │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 2: Regex Fallback         │
│  ─────────────────────────────   │
│  - 信用卡号: \b(?:\d[ -]*?){13,19}\b│
│  - 社保/身份证: 各国格式匹配        │
│  - 补充 GLiNER 的漏检              │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 3: Text Redaction         │
│  ─────────────────────────────   │
│  - 替换: john@email.com           │
│    → [REDACTED:email]             │
│  - 替换: 4111-1111-1111-1111      │
│    → [REDACTED:credit_card]       │
│  - 保存原始值到加密审计日志         │
│  Breadcrumb:                       │
│  "[pii-mask] write failed: %v"    │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 4: Visual Blur (截图)      │
│  ─────────────────────────────   │
│  - fullBlur: 近似全屏模糊          │
│  - regionBlur: 敏感区域模糊        │
│    (如支付页面、密码管理器窗口)     │
│  - 保存模糊后截图                  │
│  Breadcrumb:                       │
│  "[pii-mask] full blur failed: %v"│
│  "[pii-mask] region blur failed"   │
│  "[pii-mask] panic (frame dropped)"│
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 5: PII Tokenizer          │
│  ─────────────────────────────   │
│  - 分词: 将文本切分为 token        │
│  - 标记: 哪些 token 是 PII        │
│  - words_mask tensor:             │
│    [0,0,0,1,1,1,1,0,0,0,...]     │
│    (1 = PII token, 需掩码)        │
│  Events:                           │
│  "[pii] words_mask tensor: %v"    │
│  "[pii] output tensor: %v"        │
└──────────────────────────────────┘
```

### 9.5 Closed Eyes Detection（闭眼检测）

**目的**: 当用户不在屏幕前时暂停录制，保护隐私。

```go
type ClosedEyesDetector struct {
    model     *ONNXModel     // 可能是轻量级人脸/眼部检测模型
    threshold float64        // 检测阈值
    isEnabled bool
    mode      string         // "auto" / "always-record" / "always-pause"
}

// 工作流程:
// 1. 每次截图后检测画面中是否有人脸
// 2. 检测眼睛状态 (closed/open)
// 3. 如果闭眼或无人 → 丢弃当前帧 (不保存)
// 4. 如果长时间闭眼 → 暂停录制

// 事件:
// "[closed-eyes] toggle failed: %v"
// "[closed-eyes] hotkey toggle failed: %v"
// "[closed-eyes] hotkey toggled mode to %t"
// "[closed-eyes] overlay click failed: %v"
// "[closed-eyes] disabled from overlay eye click"
// "[activity] failed to discard pending closed-eyes snapshot %s: %v"
```

### 9.6 隐私相关 UI 元素

```css
/* 从 JS bundle 提取的脱敏 UI */
.redaction-shield-wrap {
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    display: inline-flex;
    /* 覆盖敏感内容的视觉盾牌 */
}
```

### 9.7 Trace 导出脱敏

```go
// trace 导出时的脱敏:
// trace.jsonl:     full redacted timeline    (完整脱敏时间线)
// network.jsonl:   redacted network events   (脱敏网络事件)
// console.jsonl:   redacted console events   (脱敏控制台事件)
// state/:          final snapshots when available
// screenshots/:    脱敏后的截图

// Redaction 格式:
// [REDACTED:_inttotime]  → 时间戳脱敏
// [REDACTED:email]       → 邮箱脱敏
// [REDACTED:credit_card] → 信用卡脱敏
```

### 9.8 Privacy Filter（窗口排除）

```go
// 在截图阶段直接排除某些窗口:
type PrivacyFilter struct {
    excludedBundles []string
    excludedTitles  []string
    excludedURLs    []string
}

// 预配置的排除列表:
// 密码管理器: 1Password, Bitwarden, KeePassXC, macOS Passwords
// 隐身浏览: Chrome Incognito, Safari Private Browsing
// 支付页面: billing, checkout, stripe.com
// 敏感应用: 银行 app, 医疗 app (用户可配置)

// 从二进制提取的排除 bundle IDs:
// com.1password, com.agilebits (1Password)
// com.bitwarden (Bitwarden)
// org.keepassxc (KeePassXC)
// com.apple.Passwords (macOS Passwords)

// 用户可通过 API 管理:
// AddSensitiveApp(bundleID)
// RemoveSensitiveApp(bundleID)
// GetSensitiveApps() → [string]
```

### 9.9 Breadcrumb 审计系统

**目的**: 追踪每次隐私处理操作，用于调试和合规。

```
[ocr] breadcrumb start call_id=%d source=pii-mask priority=%s file=%s bytes=%d
[ocr] breadcrumb failed call_id=%d source=pii-mask duration_ms=%d err=%v
[ocr] breadcrumb done call_id=%d source=pii-mask duration_ms=%d observations=%d
[ocr] breadcrumb failed call_id=%d source=highlight duration_ms=%d err=%v

每个 breadcrumb 包含:
  - call_id:    唯一调用 ID
  - source:     处理来源 (pii-mask / highlight / ...)
  - priority:   优先级
  - file:       处理的文件名
  - bytes:      处理的数据量
  - duration_ms: 处理耗时
  - observations: 检测到的 PII 实体数量
  - err:        错误信息
```

---

## 模块 10: 前端架构

### 7.1 React 组件树

```
App.tsx
├── ThemeProvider (paper / onedark / system)
│   ├── SessionLayout
│   │   ├── Sidebar
│   │   │   ├── WorkspaceSelector
│   │   │   ├── ProjectList
│   │   │   ├── CrystalList
│   │   │   ├── ChronJobList
│   │   │   └── MemoryQuickSearch
│   │   ├── MainPanel
│   │   │   ├── ChatView (核心对话界面)
│   │   │   │   ├── MessageList
│   │   │   │   ├── MessageInput
│   │   │   │   ├── ToolCallRenderer
│   │   │   │   └── HandoffBanner
│   │   │   ├── MemoryViewer
│   │   │   │   ├── MemoryTimeline
│   │   │   │   ├── KnowledgeCard
│   │   │   │   └── SemanticSearchBar
│   │   │   ├── ActivityTimeline
│   │   │   │   ├── TimelineBar
│   │   │   │   ├── SnapshotCard
│   │   │   │   └── SegmentSummary
│   │   │   └── Settings
│   │   │       ├── GeneralSettings
│   │   │       ├── ActivitySettings
│   │   │       ├── MemorySettings
│   │   │       ├── IntegrationSettings
│   │   │       ├── MCPSettings
│   │   │       └── BillingSettings
│   │   └── StatusBar
│   │       ├── ActivityMonitorStatus
│   │       ├── CronNextRun
│   │       └── MemoryStats
│   ├── QuickChat (独立的快速对话窗口)
│   ├── Spotlight (Spotlight 集成面板)
│   └── Toast (通知组件)
├── CrystalHost (Crystal 应用容器)
│   └── iframe/webview (每个 Crystal 独立渲染)
└── common/
    ├── Button, Input, Modal, Dropdown...
    ├── SearchBar
    ├── LoadingSpinner / Skeleton
    └── ErrorBoundary
```

### 7.2 主题系统

```typescript
// 主题定义 (从 JS bundle 提取)
const THEMES = {
  paper: {
    id: 'paper',
    label: 'Light',
    isDark: false,
    terminal: {
      background: '#ffffff',
      foreground: '#1a1a1a',
      cursor: '#2f7ae5',
      selectionBackground: 'rgba(47, 122, 229, 0.18)',
      black: '#1a1a1a',
      red: '#cf483e', green: '#3f8142', yellow: '#b2954a',
      blue: '#2f7ae5', magenta: '#942f7a', cyan: '#1f7a8c',
      white: '#f5f5f5',
      brightBlack: '#1a1a1a', brightRed: '#cf483e',
      brightGreen: '#3f8142', brightYellow: '#b2954a',
      brightBlue: '#2f7ae5', brightMagenta: '#942f7a',
      brightCyan: '#1f7a8c', brightWhite: '#1a1a1a'
    },
    tab: { bg: '#f5f5f5', activeBg: '#ffffff' },
    sidebar: { bg: '#fafafa', border: 'rgba(0,0,0,0.08)' },
    message: { user: '#2f7ae5', assistant: '#f5f5f5' }
  },
  onedark: {
    id: 'onedark',
    label: 'Dark',
    isDark: true,
    terminal: {
      background: '#101010',
      foreground: '#f5f5f5',
      cursor: '#3b82f6',
      selectionBackground: 'rgba(59, 130, 246, 0.22)',
      black: '#101010',
      red: '#e0556a', green: '#8cc265', yellow: '#d19b55',
      blue: '#3b82f6', magenta: '#bf68d9', cyan: '#4cb8b8',
      white: '#f5f5f5',
      brightBlack: '#5a5a5a', brightRed: '#e0556a',
      brightGreen: '#8cc265', brightYellow: '#d19b55',
      brightBlue: '#3b82f6', brightMagenta: '#bf68d9',
      brightCyan: '#4cb8b8', brightWhite: '#f5f5f5'
    },
    tab: { bg: '#1a1a1a', activeBg: '#101010' },
    sidebar: { bg: '#151515', border: 'rgba(255,255,255,0.06)' },
    message: { user: '#3b82f6', assistant: '#1e1e1e' }
  }
};

// 主题持久化
const THEME_KEY = 'yansu.theme';

function getTheme(): string {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'paper' || stored === 'onedark') return stored;
  } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'onedark' : 'paper';
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
}
```

### 7.3 Crystal 应用系统

Crystal 是 Yansu 的可嵌入迷你应用。每个 Crystal 是一个独立的 React/Vite 小应用。

```typescript
// Crystal 加载流程
interface CrystalManifest {
  name: string;
  version: string;
  entry: string;        // HTML 入口文件
  description: string;
  icon: string;         // SVG icon
  permissions: string[];
  type: 'app' | 'tool' | 'widget';
}

// Crystal 宿主容器 (CrystalHost)
// 1. 从 crystals 表读取启用的 Crystal 列表
// 2. 每个 Crystal 在独立 iframe/webview 中渲染
// 3. 通过 postMessage IPC 与主应用通信
// 4. 主应用提供: memory search, agent prompt, config 等 API

// Crystal 开发模板 (从 pomodoro-timer 的 package.json):
// {
//   "name": "xxx",
//   "private": true,
//   "version": "1.0.0",
//   "type": "module",
//   "scripts": {
//     "dev": "vite",
//     "build": "vite build",
//     "preview": "vite preview",
//     "start": "vite preview --port 3001"
//   },
//   "dependencies": {
//     "lucide-react": "^0.511.0",
//     "react": "^19.1.0",
//     "react-dom": "^19.1.0"
//   },
//   "devDependencies": {
//     "@types/react": "^19.1.6",
//     "@types/react-dom": "^19.1.6",
//     "@vitejs/plugin-react": "^4.5.2",
//     "typescript": "^5.8.3",
//     "vite": "^6.4.2"
//   }
// }
```

---

## 模块 11: LLM 集成

### 8.1 多模型支持

```go
type LLMClient struct {
    providers map[string]ModelProvider
}

type ModelProvider interface {
    ChatCompletion(ctx context.Context, req ChatRequest) (*ChatResponse, error)
    ChatCompletionStream(ctx context.Context, req ChatRequest) (<-chan ChatChunk, error)
}

type ChatRequest struct {
    Model       string
    Messages    []Message
    MaxTokens   int
    Temperature float64
    Tools       []Tool
    Stream      bool
}

// 支持的模型提供者:
// 1. ANTHROPIC (Claude API)
//    - ANTHROPIC_API_KEY env
//    - ANTHROPIC_BASE_URL env (default: https://api.anthropic.com)
//    - Models: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7
//
// 2. OPENAI (OpenAI API)
//    - OPENAI_API_KEY env
//    - Models: gpt-4, gpt-5, gpt-5-codex
//
// 3. OLLAMA (本地模型)
//    - ollama serve 本地运行
//    - Models: 任意拉取的模型
//
// 4. OPENAI_COMPATIBLE (兼容 OpenAI API 的服务)
//    - OPENAI_BASE_URL env

// 模型配置:
// - AnalysisModel: 用于 triage/summary (默认 haiku/gpt-4-mini)
// - ConsolidationModel: 用于 dream merge (默认 sonnet/gpt-4)
// - AgentModel: 用于 agent 对话 (默认 sonnet/gpt-4)
```

### 8.2 不同任务的模型选择

```go
type ModelConfig struct {
    TriageModel        string  // "haiku" - 快速分类
    CrystallizeModel   string  // "haiku" - 日常总结
    DeepCrystallizeModel string // "sonnet" - 重要内容深入总结
    DreamMergeModel    string  // "sonnet" - 记忆合并
    AgentDefaultModel  string  // "sonnet" - Agent 对话
    SummaryModel       string  // "haiku" - 每日/每周摘要
    EmbeddingModel     string  // ONNX 本地模型
}

// 模型选择逻辑:
// 1. Triage: 始终用 haiku (速度快、成本低)
// 2. Crystallize: 
//    - 普通 segment → haiku
//    - 检测到重要决策/技术内容 → sonnet
// 3. Dream merge: 
//    - sonnet (需要高质量合并)
// 4. Agent:
//    - 用户可配置默认模型
//    - 复杂任务自动升级到 opus
```

---

## 模块 12: 部署与打包

### 9.1 构建流程

```bash
# Go 编译
CGO_ENABLED=1 \
GOARCH=arm64 \
GOOS=darwin \
go build \
  -tags="desktop,wv2runtime.download,production" \
  -ldflags="
    -X main.Version=0.1.290
    -X main.GitCommit=e5e66a6fe126
    -X main.BuildTime=2026-05-19T00:00:21Z
    -X main.DefaultWebBaseURL=https://dashboard.yansu.ai
    -X main.R2ManifestURL=https://release.yansu.app/version.json
    -w -s
  " \
  -o Yansu

# 前端构建
cd frontend
bun install
bun run build   # vite build

# Wails 打包
wails build \
  --platform darwin/arm64 \
  --clean \
  --production

# 最终产物: Yansu.app
```

### 9.2 App Bundle 结构

```
Yansu.app/
├── Contents/
│   ├── Info.plist
│   ├── MacOS/
│   │   └── Yansu                      # Go 二进制 (embedded frontend + all resources)
│   ├── Resources/
│   │   ├── iconfile.icns              # 应用图标
│   │   ├── bun-bundle/bin/bun         # Bun JavaScript runtime
│   │   ├── git-bundle/                # Git 客户端 (bundled)
│   │   ├── ffmpeg-bundle/bin/ffmpeg   # FFmpeg (音频处理)
│   │   ├── cua-driver-bundle/         # CUA Driver (原生 macOS 应用)
│   │   │   └── CuaDriver.app/
│   │   │       └── Contents/MacOS/cua-driver
│   │   └── yansu-cli-bundle/bin/yansu # CLI 工具
│   └── Frameworks/
│       ├── libsherpa-onnx-c-api.dylib    # Sherpa-ONNX C API
│       ├── libsherpa-onnx-cxx-api.dylib  # Sherpa-ONNX C++ API
│       ├── libonnxruntime.dylib          # ONNX Runtime
│       └── libonnxruntime.1.24.4.dylib   # ONNX Runtime 1.24.4
└── _CodeSignature/
    └── CodeResources                    # 代码签名
```

### 9.3 系统框架依赖

```
链接的 macOS 框架:
  - Carbon             (窗口管理)
  - Vision             (OCR / 图像识别)
  - ImageIO            (图像编码/解码)
  - CoreText           (文字渲染)
  - CoreFoundation     (基础类型)
  - Security           (加密/钥匙串)
  - AVFoundation       (音视频)
  - Foundation         (基础 API)
  - CoreAudio          (音频)
  - AppKit             (GUI)
  - Cocoa              (GUI)
  - WebKit             (WebView)
  - QuartzCore         (图形)
  - ServiceManagement  (启动项)
  - CoreGraphics       (图形)
  - ApplicationServices (应用服务)
  - UserNotifications  (通知)
```

---

## 附录 A: Go 模块依赖

```
核心框架:
  github.com/wailsapp/wails/v2              # Wails v2 GUI 框架

AI / ML:
  github.com/k2-fsa/sherpa-onnx-go          # 语音识别 SDK
  github.com/k2-fsa/sherpa-onnx-go-macos    # macOS 特定实现
  github.com/yalue/onnxruntime_go           # ONNX Runtime Go 绑定
  modernc.org/sqlite                        # 纯 Go SQLite

MCP:
  github.com/mark3labs/mcp-go              # MCP 协议 Go 实现

自动化:
  github.com/go-rod/rod                     # 浏览器自动化
  github.com/ysmood/leakless               # 内存泄漏防护
  github.com/ysmood/gson                   # JSON 工具

调度:
  github.com/robfig/cron/v3                # Cron 调度器

Web:
  github.com/gorilla/websocket             # WebSocket
  github.com/yosida95/uritemplate/v3       # URI 模板

工具:
  github.com/google/uuid                   # UUID
  github.com/google/jsonschema-go          # JSON Schema
  github.com/samber/lo                     # 函数式工具
  github.com/spf13/cast                    # 类型转换
  github.com/dustin/go-humanize            # 人性化数字
  github.com/skratchdot/open-golang        # 系统默认打开
  github.com/pkg/browser                   # 浏览器打开
  github.com/mattn/go-isatty               # TTY 检测
  github.com/ncruces/go-strftime           # strftime

文件处理:
  github.com/bmatcuk/doublestar/v4         # Glob 匹配
  github.com/wailsapp/mimetype             # MIME 类型检测

终端:
  github.com/aymanbagabas/go-pty           # PTY
  github.com/creack/pty                    # PTY

解析:
  github.com/leaanthony/go-ansi-parser     # ANSI 解析
  github.com/leaanthony/slicer             # 切片工具
  github.com/leaanthony/u                  # 工具函数
  github.com/tkrajina/go-reflector         # 反射工具
  github.com/rivo/uniseg                   # Unicode 分段
  github.com/remyoudompheng/bigfft         # 大整数 FFT

标准库扩展:
  golang.org/x/crypto                      # 加密
  golang.org/x/net                         # 网络
  golang.org/x/sys                         # 系统调用
  golang.org/x/text                        # 文本处理
  golang.org/x/sync                        # 同步原语
  golang.org/x/exp                         # 实验特性

现代 C 实现:
  modernc.org/libc                         # libc 实现
  modernc.org/mathutil                     # 数学工具
  modernc.org/memory                       # 内存管理

其他:
  github.com/u-root/u-root                 # 系统工具
  github.com/ysmood/got/fetchup            # HTTP 请求
```

---

## 附录 B: 复刻优先级

### P0 — 核心感知 + 记忆管道 (最小可行系统)

| 模块 | 复杂度 | 说明 |
|------|--------|------|
| ScreenCapture (ScreenCaptureKit) | 中 | 定时截图 + 隐私过滤 |
| OCR (macOS Vision API) | 低 | 用系统 API 替代 ONNX |
| Activity Pipeline (Segmenter) | 中 | 数据分段 |
| Memory Crystallizer + LLM | 中 | 核心记忆生成 |
| SQLite Schema | 中 | 完整 DDL |
| Wails v2 App Shell | 低 | 最小 GUI |

### P1 — 多模态感知

| 模块 | 复杂度 | 说明 |
|------|--------|------|
| AXObserver | 中 | Accessibility API |
| Audio Transcription | 高 | 需要 Sherpa-ONNX |
| Message Scanners | 高 | 多平台集成 |
| Dedup Engine | 中 | 语义去重 |
| Dream Engine | 中 | 记忆合并归档 |

### P2 — 执行能力

| 模块 | 复杂度 | 说明 |
|------|--------|------|
| Agent Runner | 高 | LLM Agent + Tool Calling |
| MCP Hub | 中 | MCP 协议 |
| CUA Driver | 高 | 桌面自动化 |
| Cron Scheduler | 低 | 定时任务 |
| Spotlight Integration | 中 | macOS 特有 |

### P3 — 生态扩展

| 模块 | 复杂度 | 说明 |
|------|--------|------|
| Crystal Apps | 低 | 插件系统 |
| Handoff | 低 | Agent 交接 |
| Skills System | 中 | 可安装技能包 |
| React Frontend | 中 | 完整 GUI |
