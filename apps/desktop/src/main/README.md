<!--
Input: Electron main-process source files.
Output: Main-process module inventory and ownership notes.
Position: apps/desktop/src/main/README.md
-->

# Desktop Main Process

这个目录拥有 Electron main process 的启动、窗口生命周期、server 子进程、native IPC service、Velopack update runtime，以及 desktop plugin runtime。

## 文件清单

- `index.ts`：main process 入口；负责最早运行 Velopack startup hook，再加载实际 Desktop app bootstrap。
- `main-app.ts`：负责激活 desktop plugins、启动 server、创建主窗口、接入 update manager，并把 webview creation event 转发给 plugin loader。
- `window-state.ts`：拥有主窗口 bounds 恢复校正逻辑；在 `electron-window-state` 持久化基础上按当前 display workArea 修正大小和位置。
- `window-manager.ts`：拥有 Electron window lifecycle 和 renderer/server URL 连接。
- `server-process.ts`：拥有 server 子进程启动、停止、环境变量注入，以及 desktop-owned credential secret 文件。
- `native-services.ts`：拥有 main-process native IPC service 注册。
- `update-manager.ts`：拥有 Velopack update feed URL 解析、后台检查、下载进度、应用更新，以及 renderer 状态事件。
- `plugin-discovery.ts`：拥有 desktop plugin discovery 和 manifest validation。
- `plugin-loader.ts`：拥有 desktop plugin activation、shared config projection、webview listener registry，以及 renderer browser tab bridge。
- `browser-backend.ts`：legacy browser-use socket backend。当前 main process 不会启动这个 backend；active browser-use path 是 `plugins/browser-use/src/desktop.ts` 通过 desktop plugin loader 激活。

## Browser-use backend ownership

当前 browser-use 的生产路径由 plugin system 拥有：

1. `plugin-loader.ts` 激活 desktop plugin，并提供 `DesktopPluginContext`。
2. `plugins/browser-use/src/desktop.ts` 启动 browser backend socket。
3. renderer bridge 创建、激活、查询 browser panel tab，并把 webview creation event 回传给 plugin backend。

`browser-backend.ts` 只保留为 legacy/compatibility path。它不拥有 browser panel tab creation 语义，也不应该作为新功能入口继续扩展。需要变更 browser automation 行为时，优先修改 plugin-owned backend 和 plugin SDK bridge；如果 legacy backend 需要恢复为 active path，应先对齐 `tabs_new`、active tab lookup、screenshot capture 等语义，再接入 main process 启动流程。
