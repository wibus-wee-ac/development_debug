<!--
Input: Alma fatigueService evidence and Cradle agent state audit.
Output: Spec for personal fatigue/sleep state.
Position: docs/specs/alma-inspired/fatigue-sleep-state.md
-->

# Fatigue 与 Sleep State

## 目标

Cradle 只有在有明确用户价值和 consent model 时，才应引入 personal fatigue 或 sleep state。该能力必须是用户可控状态，而不是隐藏在 chat runtime 里的 prompt 注入副作用。

## Alma 证据

Alma 包含 `fatigueService` chunk，会持久化 fatigue state、message counts、last rest time、manual sleep/wake，并把 awake、tired、sleepy、sleeping 状态注入 prompts。

## Cradle 当前状态

Cradle 有 agent/session state、Chronicle 和 automation，但没有 personal fatigue/sleep state owner，也没有把用户个人状态注入 prompts 的 consent surface。

## Owner / Namespace

未来 personal state owner 管理 user-controlled state、consent、deletion 和 prompt exposure policy。`chat-runtime` 只读取已授权的 state snapshot，不拥有 state lifecycle。

## 目标行为

- 用户可以 opt in personal state tracking。
- 用户可以手动设置 active、resting 或 unavailable。
- Prompt context 只有在用户启用后才能包含 personal state。
- 用户可以 reset 或 delete state，且删除不影响 chat history。

## API 草案

- `GET /personal-state`
- `PUT /personal-state`
- `POST /personal-state/reset`

## 数据模型

保存 state、last updated time、source、consent version、prompt exposure flag 和 deletion timestamp。不要在未经明确同意时从 private content 推断 health-related state。

## 验收

- 禁用 personal state 后，后续 prompt context 不再包含该状态。
- Manual state changes 可见、可逆，并写入 audit event。
- State data 可以独立于 chat history 删除。
