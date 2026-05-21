<!--
Input: Alma tray/global shortcut evidence and Cradle desktop tray audit.
Output: Spec for tray, shortcuts, app lifecycle, and desktop entrypoints.
Position: docs/specs/alma-inspired/system-tray-shortcuts.md
-->

# 系统托盘与快捷键

## 目标

Cradle 需要提供低摩擦 native desktop 入口：托盘动作、全局快捷键、Quick Chat、恢复当前 session、打开 settings，以及可配置的应用生命周期行为。

## Alma 证据

Alma 的 Tray 包含 show app、Quick Chat、Activity Recorder 控制、recent digest、settings、quit。它为 Quick Chat 和 Prompt Apps 注册全局快捷键，并支持 auto start、dock visibility、app icon 切换、CLI wrapper 安装和 PATH 修复。

## Cradle 当前状态

Cradle 已有 tray popover，包含 quick actions、running/resident sessions、approvals、awaits、automation、workspaces、Chronicle、usage、plugins、settings、quit。Cradle 也有 Velopack 更新和 server fork，但还没有完整 global shortcut registry 与 lifecycle settings UI。

## Owner / Namespace

`apps/desktop` 拥有 native tray、global shortcuts、login item、dock visibility、app icon 和 shell integration。`preferences` 持久化用户设置。feature owner 只提供只读 tray projection。

## 目标行为

- 用户可以配置 new chat、quick chat、global search、settings、active session resume 的全局快捷键。
- 托盘动作来自 server-owned snapshots。
- 生命周期设置在 Settings 中可见，并在安全时立即应用。
- 快捷键冲突需要检测并给出可操作错误。

## API / IPC 草案

- `GET /desktop/tray`
- `GET /preferences/desktop-lifecycle`
- `PUT /preferences/desktop-lifecycle`
- `desktop.shortcuts.register(actionId, accelerator)`
- `desktop.shortcuts.unregister(actionId)`

## 验收

- 修改快捷键后 native registration 无需重启即可更新。
- 禁用快捷键后全局注册被移除。
- auto-start 和 dock visibility 重启后仍生效。
