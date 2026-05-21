<!--
Input: Alma UI/theme/keybinding settings evidence and Cradle design/preferences audit.
Output: Spec for UI, theme, and keybinding settings.
Position: docs/specs/alma-inspired/ui-theme-keybindings.md
-->

# UI、Theme 与 Keybindings

## 目标

Cradle 需要在保持 design-system consistency 的前提下，暴露实用的 appearance、editor、terminal 和 shortcut preferences。Theme customization 不能破坏 Tailwind 静态 class 约束和 accessibility tokens。

## Alma 证据

Alma settings 包含 UI font、terminal font/size/cursor、word wrap、minimap、system caret、tool card expansion、labels、custom theme editing、base30/base16/simple colors、plugin theme card，以及 common actions 的 keybinding recording。

## Cradle 当前状态

Cradle 有 design system、appearance settings、desktop update settings、agent/provider settings，以及部分 shortcut-driven UI behavior。当前没有完整 keybinding recorder 或 theme editor equivalent。

## Owner / Namespace

`preferences` 拥有 persisted settings。`apps/web` 拥有 design-system-compatible UI。`apps/desktop` 拥有 global shortcut application。Plugins 只能通过受治理的 API 贡献 theme extensions，不能直接覆盖核心 tokens。

## 目标行为

- 用户可以配置 theme mode、density、font choices、terminal display、chat rendering preferences 和 keybindings。
- Keybinding conflicts 必须在保存前被检测。
- Plugin themes 不能覆盖 core accessibility constraints。
- Design tokens 保持静态定义，兼容 Tailwind purge 和 design-system docs。

## API 草案

- `GET /preferences/appearance`
- `PUT /preferences/appearance`
- `GET /preferences/keybindings`
- `PUT /preferences/keybindings`

## 数据模型

Preferences 只保存 user overrides。Defaults 存在 code 和 design-system docs 中。Keybinding records 保存 action id、scope、accelerator、platform、enabled 和 conflict metadata。

## 验收

- Reset appearance 会回到 design-system defaults。
- Invalid keybindings 会被拒绝，并返回 conflict details。
- Theme changes 不会引入 dynamic Tailwind class construction。
- Plugin theme extension 不能降低 contrast 或覆盖 required focus indicators。
