# Chronicle Web Feature

此目录负责 `Settings > Chronicle` 的 Web UI。它把当前生成的 Chronicle API client 适配为稳定的本地 UI 类型，并渲染 capture 开关、runtime status、model selection、Slack source sync、本地模型资源类别、capture/message timeline、memories 与 memory search。

## Files

- `use-chronicle.ts`: React Query hooks 与窄兼容适配层，覆盖 Chronicle config、status、model resources、Slack message sources、Slack sync、timeline、memories、Server-side memory search 与手动刷新。
- `chronicle-settings.tsx`: Settings 页面实现，使用既有 settings rows、provider model picker、静态 Tailwind classes 与 Chronicle hooks。

## API Compatibility Boundary

Server/DB 工作并行推进期间，部分生成的 Chronicle response types 仍是 `unknown`。`use-chronicle.ts` 是 Web 侧唯一的兼容边界，用于同时接受旧 file-backed response 与计划中的 DB-backed shapes：

- Timeline arrays 可以来自 root、`entries`、`timeline` 或 `snapshots`。
- Memory arrays and search results 可以来自 root、`entries`、`memories` 或 `results`。
- Model resource arrays 可以来自 root、`resources`、`modelResources` 或 `models`。
- Slack message source arrays 可以来自 root、`sources` 或 `messageSources`。

当 API generation 追上 Server schema 后，应保持 UI component 稳定，并收紧 `use-chronicle.ts` 中的 adapters，不要把 casts 扩散到 `chronicle-settings.tsx`。

## Ownership Notes

Chronicle-owned local model resources 会显示为 Chronicle resources，而不是 provider profile data。Provider profiles 只用于远程 summary generation 的 model selection。当前首个可用本地路径是 screen capture 加 OCR；audio VAD、ASR、speaker 与 embedding resources 默认显示为 optional，除非 Server 返回更严格的状态。

Slack token 明文只通过现有 `/secrets` 写入 Server secrets。Web 不把 token 写进 Chronicle config；Chronicle source 只保存 secret ref 与 channel allowlist。当前 UI 提供手动 sync，后续后台 scanner 应复用同一 source 列表与 timeline/memory 展示。
