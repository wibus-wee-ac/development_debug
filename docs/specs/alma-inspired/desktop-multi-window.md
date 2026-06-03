# 桌面多窗口表面

## 目标

Cradle 需要支持有明确 owner 的桌面多窗口表面，用于承载不适合塞进主 tab shell 的体验：通知、Quick Chat、媒体灯箱、Prompt App runner、分享预览、托盘 popover、Devtool、独立 session 窗口。

## Alma 证据

Alma 打包了 `index.html`、`settings.html`、`notifications.html`、`lightbox.html`、`prompt-app-runner.html`、`livecoding.html`、`gallery.html`、`share.html`。preload 还暴露了 `settingsWindow`、`promptAppRunner`、`galleryWindow`、`lightboxWindow`、`liveCodingWindow`、`quickChatWindow` 等窗口专用 bridge。

## Cradle 当前状态

Cradle Desktop 当前有主窗口、托盘 popover、Devtool 窗口和 detached session 窗口。它已经具备窗口基础设施，但还没有 media、share、prompt runner、live coding、quick chat 这些专用窗口表面。

## Owner / Namespace

`apps/desktop` 只拥有 BrowserWindow 生命周期、路由、显示器定位、focus policy 和 preload 边界。每个产品表面自己的状态和 UI 必须归属 `apps/web/src/features/*` 或对应 server module。Desktop 不拥有业务语义。

## 目标行为

- 建立桌面窗口 registry，定义稳定的 `windowKind`。
- 每个窗口声明 focus、透明、可缩放、置顶、click-through、display placement 策略。
- 功能状态通过 server API 或 typed IPC 传递，不能依赖全局 renderer mutable state。
- 二级窗口可以跳回主窗口中的 canonical session、workspace 或 asset。

## API / IPC 草案

- `desktop.windows.open(kind, payload)`
- `desktop.windows.close(kind, id)`
- `desktop.windows.focus(kind, id)`
- `desktop.windows.list()`

## 数据模型

只持久化窗口 bounds、last display、last mode 等用户偏好。产品数据继续归 feature owner。

## 验收

- 打开 lightbox 或 prompt runner 不会复制 session canonical state。
- 关闭二级窗口不会删除 session、workspace 或 asset。
- 重启后窗口 bounds 可恢复，外接显示器变化后窗口仍保持可见。
