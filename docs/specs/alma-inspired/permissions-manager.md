# 权限管理

## 目标

Cradle 需要为 screen recording、accessibility、microphone、notifications、file access、browser automation 等 native capabilities 提供统一权限表面。

## Alma 证据

Alma preload 暴露 `permissions`、`accessibility`、microphone permission methods、permission overlay drag、status change events、system settings deep links。

## Cradle 当前状态

Cradle 使用 native dialogs，Chronicle 需要 screen capture permission，但没有统一 permissions status API 或 settings UI。

## Owner / Namespace

`apps/desktop` 拥有 OS permission checks 和 system settings deep links。`preferences` 持久化用户意图。Feature owner 声明 required permissions，并通过 central projection 读取 status。

## 目标行为

- Settings 展示 required、optional、granted、denied、unknown permissions。
- Feature 可查询 permission status，且不会触发 prompt。
- Request flow 必须解释为什么需要权限。
- Permission changes 广播给相关 UI。

## API / IPC 草案

- `desktop.permissions.getAll()`
- `desktop.permissions.request(kind)`
- `desktop.permissions.openSettings(kind)`
- `desktop.permissions.onStatusChanged(handler)`

## 数据模型

只存用户 dismissals 与 explanation state。OS permission state 实时查询 OS。

## 验收

- Chronicle 启动 capture 前能显示 screen recording permission status。
- Quick Chat 能检测 accessibility permission 缺失并给出操作。
- Denied permission state 包含 open-settings action。
