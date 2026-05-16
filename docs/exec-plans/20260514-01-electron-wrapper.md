# Electron Wrapper 回归

> Date: 2026-05-14
> Status: In Progress

## Summary

将 Cradle 打包为 Electron 桌面应用：Web → Renderer, Server → Main Process 内嵌启动。

## Architecture

```
apps/desktop/
├── package.json          # electron + electron-vite + electron-builder
├── electron-builder.yml  # 打包配置
├── tsconfig.json
├── tsconfig.node.json
├── src/
│   ├── main/
│   │   ├── index.ts            # app.whenReady → start server → createWindow
│   │   ├── server-process.ts   # 启动 @cradle/server (in-process / fork)
│   │   ├── window-manager.ts   # BrowserWindow 管理 + tearoff
│   │   └── native-services.ts  # IPC services (file picker, etc)
│   ├── preload/
│   │   └── index.ts            # contextBridge 暴露 IPC + env
│   └── renderer/               # → 直接 load apps/web (dev: vite URL, prod: file://)
└── resources/
    └── icon.png
```

## Tasks

### Phase 1: Shell & Boot
- [x] `apps/desktop/package.json` — electron 39, electron-vite, electron-builder
- [x] Main process: app ready → find free port → spawn/import server → create BrowserWindow
- [x] Preload: `contextBridge.exposeInMainWorld('cradle', { ipc, env, platform })`
- [x] Dev mode: concurrently server + web + electron (electron-vite dev)
- [x] Production: electron-builder with asar, extraResources for native modules

### Phase 2: Native IPC Services (via @cradle/ipc)
- [x] `NativeService` — file picker (dialog.showOpenDialog), save dialog
- [x] `WindowService` — tearOff, focus, close session windows
- [x] Web side: detect electron env → use native picker instead of browser picker

### Phase 3: Tab Tearoff
- [x] `WindowManager` — manage session tearoff windows
- [x] Hook into the tab runtime `onTabTearOff` → IPC → new BrowserWindow

### Phase 4: Devbar
- [ ] Electron-only devtool window (IPC observer panel)

### Phase 5: E2E
- [ ] Playwright Electron support alongside browser testing

## Key Decisions

1. **Server lifecycle**: In-process import (not fork) for simplicity — server runs in main process
2. **Port handling**: `getPort()` to find free port, inject into renderer via preload
3. **IPC strategy**: Native features → @cradle/ipc (Electron IPC), all other data → HTTP API (same as web)
4. **Dev workflow**: electron-vite handles all three (main/preload/renderer) with HMR
