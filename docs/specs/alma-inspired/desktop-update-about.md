<!--
Input: Alma auto update/about evidence and Cradle desktop/update audit.
Output: Spec for desktop updates, about page, and release diagnostics.
Position: docs/specs/alma-inspired/desktop-update-about.md
-->

# Desktop Update 与 About

## 目标

Cradle 需要把 desktop update、release diagnostics 和 About surface 作为 desktop-owned capability，而不是散落在 settings、telemetry 或 tray 里。该能力应帮助用户理解当前版本、更新状态、runtime paths 和可复制诊断信息。

## Alma 证据

Alma main/system 证据包含 auto update、Sentry release metadata、PostHog signals、About 页面相关 settings，以及 renderer 功能清单中的 About。系统集成证据还包含 CLI wrapper 安装和 PATH repair。

## Cradle 当前状态

Cradle desktop 有 Velopack update 和 server fork，settings 中有 desktop update 表面。当前还缺一个统一的 About/release diagnostics spec，用来约束 update state、version display、logs path、server health 和 telemetry consent 的关系。

## Owner / Namespace

`apps/desktop` 拥有 update check、download、install、restart coordination、native app version 和 release channel。`preferences` 保存 update policy。`health` 和 `observability` 提供只读 diagnostics。Telemetry consent 仍归 `product-telemetry` spec。

## 目标行为

- 用户可以查看 app version、server version、release channel、update availability 和 last check result。
- 用户可以手动 check for updates，并看到 download/install/restart 状态。
- About surface 提供可复制 diagnostics，不包含 secrets、prompt content 或 private workspace paths。
- Update failure 进入 local observability，并显示可操作错误。

## API / IPC 草案

- `GET /desktop/about`
- `GET /desktop/update`
- `POST /desktop/update/check`
- `POST /desktop/update/apply`

## 数据模型

Update policy 存在 preferences。Update history 可以保留轻量 local diagnostics：version、channel、status、checkedAt、errorCode。不要把 installer artifacts 写入 feature-owned business namespace。

## 验收

- About page 能复制 redacted diagnostics。
- Manual update check 返回结构化状态，而不是只写日志。
- Update policy change 重启后保持生效。
