# Desktop Main Process

这个目录拥有 Electron main process 的启动、窗口生命周期、server 子进程、native IPC service、Velopack update runtime，以及 desktop plugin runtime。

## 文件清单

- `index.ts`：main process 入口；负责最早运行 Velopack startup hook，再加载实际 Desktop app bootstrap。
- `main-app.ts`：负责激活 desktop plugins、启动 server、创建主窗口、接入 update manager、注册 `cradle://` protocol，并把 webview creation event 转发给 plugin loader。
- `desktop-assets.ts`：解析 Electron main process 在 dev 和 packaged runtime 中使用的 preload 与 renderer asset 路径，兼容 electron-vite main chunk 输出目录。
- `desktop-assets.test.ts`：覆盖 dev preload 路径从 `dist/main/chunks` 回溯到 `dist/preload/index.js`，以及 packaged preload 路径解析。
- `tray-manager.ts`：拥有 Electron native tray icon、native tray menu、tray action IPC，以及主窗口聚焦/转发流程。
- `window-state.ts`：拥有主窗口 bounds 恢复校正逻辑；在 `electron-window-state` 持久化基础上按当前 display workArea 修正大小和位置。
- `window-manager.ts`：拥有 Electron window lifecycle 和 renderer/server URL 连接。
- `server-process.ts`：拥有 server 子进程启动、停止、环境变量注入，以及 desktop-owned credential secret 文件。
- `native-services.ts`：拥有 main-process native IPC service 注册。
- `update-manager.ts`：拥有 Velopack update feed URL 解析、后台检查、下载进度、应用更新、macOS packaged `UpdateMac` handoff、restart argument handoff，以及 renderer 状态事件。
- `plugin-install-links.ts`：拥有 Marketplace install link 解析、first-party source validation、native install receipt，以及 Cradle-owned installed plugin directory 写入。
- `plugin-install-receipt.ts`：读取 plugin package 内的 Marketplace install receipt，并投影为 descriptor source provenance。
- `plugin-discovery.ts`：拥有 desktop plugin discovery 和 manifest validation。
- `plugin-discovery.test.ts`：覆盖 desktop discovery 对 Marketplace install receipt provenance 的 descriptor 投影。
- `plugin-loader.ts`：拥有 desktop plugin activation、Marketplace installed plugin discovery、shared config projection、webview listener registry，以及 renderer browser tab bridge。
- `plugin-loader.test.ts`：覆盖 desktop plugin deactivation 时清理 subscriptions、shared config projection 和 capability records。
- `plugin-install-links.test.ts`：覆盖 Marketplace install URL parsing、link rejection、bundled receipt recording 和 Cradle-owned plugin install writes。
- `plugin-paths.ts`：拥有 desktop dev/bundled runtime 的 primary plugin directory 解析，并把同一路径投影给 forked server。
- `browser-backend.ts`：legacy browser-use socket backend。当前 main process 不会启动这个 backend；active browser-use path 是 `plugins/browser-use/src/desktop.ts` 通过 desktop plugin loader 激活。

## Browser-use backend ownership

当前 browser-use 的生产路径由 plugin system 拥有：

1. `plugin-loader.ts` 激活 desktop plugin，并提供 `DesktopPluginContext`。
2. `plugins/browser-use/src/desktop.ts` 启动 browser backend socket。
3. renderer bridge 创建、激活、查询 browser panel tab，并把 webview creation event 回传给 plugin backend。

`browser-backend.ts` 只保留为 legacy/compatibility path。它不拥有 browser panel tab creation 语义，也不应该作为新功能入口继续扩展。需要变更 browser automation 行为时，优先修改 plugin-owned backend 和 plugin SDK bridge；如果 legacy backend 需要恢复为 active path，应先对齐 `tabs_new`、active tab lookup、screenshot capture 等语义，再接入 main process 启动流程。

## Desktop update ownership

`update-manager.ts` owns the renderer-visible Desktop Updates workflow. The explicit user flow is Check, Download, then Restart. Check only reads the Velopack feed and updates status; it does not implicitly download.

On packaged macOS builds, Restart starts the bundled `Contents/MacOS/UpdateMac` executable directly with an explicit `--rootDir`, `--packageDir`, `--log`, `apply --waitPid <pid>`, target package path, and the current restart arguments. This keeps the app bundle location, package cache, log file, and validation-only launch arguments observable. Non-macOS or non-packaged runtimes continue to use Velopack's JavaScript `waitExitThenApplyUpdate` binding as the fallback handoff path.
