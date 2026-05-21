<!--
Input: Alma Copilot and Claude Subscription preload evidence.
Output: Spec for subscription account OAuth flows.
Position: docs/specs/alma-inspired/subscription-account-oauth.md
-->

# Subscription Account OAuth

## 目标

Cradle 需要支持不能用普通 API key profile 表达的账号型 AI 订阅。首批只建议在明确接受产品与合规风险后考虑 GitHub Copilot 和 Claude Subscription。

## Alma 证据

Alma preload 暴露 `copilot` device-code auth、token 保存、token 获取、多账号列表、user fetch、logout；还暴露 `claudeSubscription` auth URL、authorization start/complete/cancel、token refresh、profile、quota、models、logout。

## Cradle 当前状态

Cradle 有 `profiles`、`providers` 和 encrypted `secrets`，但没有 subscription account lifecycle、device-code flow、quota fetch 或 account switcher。

## Owner / Namespace

`profiles` 拥有 account-backed provider profile metadata。`secrets` 拥有 refresh/access token material。provider-specific OAuth adapter 拥有协议细节。

## 目标行为

- 用户可以新增、刷新、查看、删除 subscription accounts。
- Token material 不进入 Web，Web 只看到 masked status。
- Provider settings 可展示 quota/model status。
- Account profile 可像其他 profile 一样被 chat runtime 选择。

## API 草案

- `POST /provider-accounts/:kind/start-auth`
- `POST /provider-accounts/:kind/complete-auth`
- `POST /provider-accounts/:id/refresh`
- `GET /provider-accounts`
- `DELETE /provider-accounts/:id`

## 验收

- Logout 删除 secret material 并禁用依赖 profile。
- Token 过期时显示可操作的 reauth status。
- 同一 provider kind 可同时存在多个账号。
