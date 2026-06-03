# 自定义通知中心

## 目标

Cradle 需要为本地 agent events 提供可排队、可操作、样式一致的桌面通知系统。

## Alma 证据

Alma 有 `notifications.html`、`almaNotifications`、`notificationWindow`、透明置顶窗口、click-through、queue updates、clear all、action clicks、theme snapshots、sounds。

## Cradle 当前状态

Cradle 有 Web toasts、tray popover、badges、approvals、awaits，但缺 native/custom notification queue 和 action API。

## Owner / Namespace

`apps/desktop` 拥有 native notification windows 和 OS notification permission。未来 notification server module 或 `desktop` projection 拥有 event queue metadata。Feature owners 发布 notification intents。

## 目标行为

- Feature 可以发布包含 title、body、severity、actions、source id、expiration 的 notification intent。
- 用户可以 click actions、dismiss、clear all、jump to source。
- Notification rendering 遵守 theme 和 do-not-disturb 设置。

## API 草案

- `POST /desktop/notifications`
- `GET /desktop/notifications`
- `POST /desktop/notifications/:id/action`
- `POST /desktop/notifications/:id/dismiss`

## 数据模型

只有需要跨重启保留的 actionable notifications 持久化。Ephemeral toasts 可保持内存态。

## 验收

- Pending approval 可以发出带 approve/reject actions 的 notification。
- Dismiss notification 不会隐式 resolve underlying approval。
- Notification window 默认不抢 focus。
