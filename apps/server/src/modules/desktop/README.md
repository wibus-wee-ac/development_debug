# Desktop Module

这个目录拥有 Desktop/Electron 专用的 server-side 投影接口。它可以读取 chat、session、workspace、automation、approval、Chronicle 等 namespace 的状态，但不拥有也不写入这些 namespace 的生命周期数据。

## 文件清单

- `index.ts`: exposes `/desktop/tray` and `/desktop/tray/awaits` for Electron Desktop tray and overview surfaces. These routes are intentionally not CLI-exposed.
- `model.ts`: Elysia response schemas for the tray snapshot contract.
- `service.ts`: read-only tray snapshot aggregation for running sessions, resident sessions, pending awaits, metrics, and desktop quick actions.
