# Quick Chat Overlay

## 目标

Cradle 需要提供全局低摩擦 chat overlay，使用户不打开主窗口也能使用当前桌面上下文发起对话。

## Alma 证据

Alma preload 暴露 `quickChatWindow`，支持 toggle、hide、expand、shortcut update、click-through、front app context、app icon、cached context、recapture context、traverse app。

## Cradle 当前状态

Cradle 有 New Chat、tray actions 和 Chronicle screen capture，但没有 global overlay、click-through mode 和 foreground app context traversal。

## Owner / Namespace

`apps/desktop` 拥有 overlay window behavior 和 native context capture。`chat-runtime` 拥有 message execution。未来 `desktop-context` server module 拥有 sanitized context snapshots。

## 目标行为

- 全局快捷键 toggle compact chat overlay。
- Overlay 可发送到新 session 或 existing Cradle session。
- 可选 context capture 包含 active app/window title、selected text、screenshot/OCR summary 和 permission provenance。
- Click-through mode 必须显式启用，并可立即关闭。

## API / IPC 草案

- `desktop.quickChat.toggle()`
- `GET /desktop/context/current`
- `POST /chat/sessions/:id/response`

## 数据模型

Context snapshots 默认 ephemeral。只有当它们被附加到 chat message 或 Chronicle memory 时才持久化。

## 验收

- 从 Quick Chat 发送会创建正常 Cradle session message。
- 禁用 context capture 后不再遍历 foreground app。
- Overlay hide/show 不丢失未发送 draft。
