# Chronicle Web Feature

此目录负责 `Settings > Chronicle` 的 Web UI。它把当前生成的 Chronicle API client 适配为稳定的本地 UI 类型，并渲染 capture 开关、runtime status、model selection、Slack source sync、本地模型资源 lifecycle、accessibility evidence、raw audio segments、meeting transcripts、capture/message/audio timeline、activity segments、pipeline runs、memories 与 memory search。

## Files

- `use-chronicle.ts`: React Query hooks 与 Chronicle canonical schema 对齐的 UI 数据层，覆盖 config、status、model resources reconcile/verify/install/remove、Slack message sources、Slack sync、Slack Events API config、accessibility evidence、raw audio segments、audio transcripts、activity segments、activity segment triage/summarization/crystallization actions、manual activity pipeline tick、knowledge cards、dream runs、pipeline runs、timeline、memories、Server-side memory search 与手动刷新。
- `chronicle-settings.tsx`: Settings 页面实现，使用既有 settings rows、provider model picker、静态 Tailwind classes 与 Chronicle hooks，并提供独立 Background Audio opt-in 开关、Automatic Activity Pipeline 开关、accessibility evidence 列表、raw audio segment evidence 列表、activity segment triage/summarization/crystallization 操作、manual pipeline tick、knowledge cards 列表、dream merge dry-run 列表/触发、pipeline run 列表、Slack realtime mode 配置、Events API callback URL 与 runtime status 展示。

## API Boundary

`use-chronicle.ts` 是 Web 侧唯一的 Chronicle API 边界：它假设 Server 按 canonical schema 返回数据（OpenAPI 生成 + 手写 fetch endpoints），并把结果整理成 Settings UI 需要的稳定类型。若 Server schema 变化，应更新 OpenAPI + 生成产物，再同步调整此文件；不要把 casts 或兼容逻辑扩散到 `chronicle-settings.tsx`。

## Ownership Notes

Chronicle-owned local model resources 会显示为 Chronicle resources，而不是 provider profile data。Provider profiles 只用于远程 summary generation 的 model selection。当前首个可用本地路径是 screen capture 加 OCR；audio VAD、ASR、speaker 与 embedding resources 默认显示为 optional，用户可以从本地文件或目录安装、从 Server 内置且具备强校验信息的 manifest 下载、校验或移除这些资源。Web 不传任意远程 URL；远程 manifest 下载由 Server 在具备强校验信息时控制。

Memory search badges 显示 Server 返回的 `Keyword`、`Semantic` 或 `Hybrid` 匹配模式。当前 semantic score 来自 Server 侧 `chronicle-lexical` deterministic local vector foundation；这不表示本地 ONNX embedding resource 已经安装或运行。

Slack token 与 signing secret 明文只通过现有 `/secrets` 写入 Server secrets。Web 不把 token 或 signing secret 写进 Chronicle config；Chronicle source 只保存 secret refs、channel allowlist 与 realtime mode。当前 UI 支持 Events API 和 polling 两种模式：Events API 显示 callback URL 并保留 polling fallback，手动 sync 仍可作为立即拉取入口。

Accessibility UI 显示 Server 已登记的 window/accessibility evidence，包括 status、provider、app/window、element count、text preview、tree node preview 和 artifact path。`Permission needed` 表示 macOS Accessibility permission 尚未授予；持久化记录中的 `macos-ax-observer` 表示 Rust AXObserver notification 触发了 AX tree capture；`macos-ax-tree-poll` 表示 Rust 定时轮询 frontmost app 的 AX tree；`macos-accessibility-window-inventory` 表示降级为窗口清单。

Audio Segments UI 显示 Rust daemon 已登记到 Server/DB 的 microphone WAV/metadata evidence，包括 active flag、RMS/peak、duration、artifact paths 以及 VAD/ASR/Speaker processing status。它不声明这些处理器已经运行。

Meeting transcript UI 显示 Server 已导入的 transcript evidence 和派生 memory 状态；它不声明本地 ASR runtime 已经完成。Background Audio 开关只允许 Rust daemon 写 microphone segment artifacts，并通过 status 显示 `Disabled`、`Unavailable` 或 `Armed`；它不表示 system audio、VAD、ASR 或 speaker labeling ready。

Activity Segments UI 显示 Server 从 snapshot、Slack、audio、transcript 和 memory evidence 聚合出的 Chronicle-owned activity windows，以及最近 pipeline runs 的 trigger、stage、status 和 error message。每个 segment 提供 Triage、Summarize 和 Crystallize 操作：Triage 调用 configured profile 判断保留价值，Summarize 会生成 segment summary 并写入 searchable memory，Crystallize 会生成 durable knowledge cards。Automatic Activity Pipeline 开关会控制 Server 后台 scheduler；Pipeline Runs 区域的 Tick 按钮会立即执行一次同样的自动推进逻辑。

Knowledge Cards UI 显示 Server 持久化的 title、content、dimension、type、confidence、tags、version 与 source counts。Dream Merge Dry Run UI 只显示 lexical candidate run 历史并允许手动触发 dry-run；它不声明自动 dream scheduling、restore/archive/prune 或 ONNX semantic merge 已经完成。
