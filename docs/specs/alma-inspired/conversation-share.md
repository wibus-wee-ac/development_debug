<!--
Input: Alma share renderer evidence and Cradle session export audit.
Output: Spec for visual conversation sharing.
Position: docs/specs/alma-inspired/conversation-share.md
-->

# Conversation Share

## 目标

Cradle 需要支持把选中的 conversation messages 转成可分享、可审阅、可归档的视觉 artifact。

## Alma 证据

Alma 有 `share.html`，通过 `share-data` 接收数据，支持 message selection、preview、header/timestamp toggles、zoom/pan preview、`modern-screenshot`、save PNG、clipboard copy。

## Cradle 当前状态

Cradle 可以导出 session Markdown 和复制 message text，但缺少视觉分享/导出 surface。

## Owner / Namespace

`session` 拥有 message snapshots。`apps/web/src/features/share` 拥有 rendering 和 export UI。Desktop 在 browser APIs 不够时提供 save dialog 与 clipboard bridge。

## 目标行为

- 用户可以选择 session 中的消息生成视觉预览。
- 用户可以包含 title、timestamps、workspace/session metadata、theme。
- 首期支持 PNG export；SVG/PDF 可延后。

## API / IPC 草案

- `GET /sessions/:id/messages`
- `desktop.saveImage(dataUrl, suggestedName)`
- `desktop.clipboard.writeImage(dataUrl)`

## 数据模型

不要求新增持久化模型。Share presets 可放入 preferences。

## 验收

- 导出的 image 与 selected messages 一致，并排除未选消息。
- Copy/save failures 返回可操作错误。
- Share preview 不修改 source session。
