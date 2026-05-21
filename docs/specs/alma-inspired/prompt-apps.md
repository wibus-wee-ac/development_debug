<!--
Input: Alma Prompt Apps renderer/preload evidence and Cradle automation/skills audit.
Output: Spec for Prompt Apps and runner.
Position: docs/specs/alma-inspired/prompt-apps.md
-->

# Prompt Apps

## 目标

Cradle 需要支持用户自定义的 prompt mini-app：把 prompt、typed inputs、runtime config、可选 tools、执行历史封装成可复用的一键 workflow。

## Alma 证据

Alma 有 `PromptAppsManager`、`prompt-app-runner.html`、`promptAppRunner` preload、动态 placeholders、file/image inputs、global shortcuts、model/tool/reasoning settings、execution history 和 image-result retry logic。

## Cradle 当前状态

Cradle 有 automation definitions、skills、slash commands 和 chat runtime，但没有 prompt app CRUD 或独立 runner surface。

## Owner / Namespace

未来 `apps/server/src/modules/prompt-apps` 拥有 prompt app definitions、input schema、execution records、shortcut metadata。`chat-runtime` 拥有实际生成。Web 拥有管理和 runner UI。Desktop 只拥有可选 runner window 与 shortcuts。

## 目标行为

- 用户可以创建、编辑、启用、禁用、复制、删除、排序 Prompt Apps。
- Inputs 支持 text、textarea、select、number、checkbox、file、image。
- 每次运行创建或恢复普通 Cradle chat session，并带 provenance metadata。
- History 记录 inputs、output session、status、errors。

## API 草案

- `GET /prompt-apps`
- `POST /prompt-apps`
- `PUT /prompt-apps/:id`
- `DELETE /prompt-apps/:id`
- `POST /prompt-apps/:id/run`
- `GET /prompt-apps/:id/runs`

## 数据模型

表应包含 `prompt_apps`、`prompt_app_inputs`、`prompt_app_runs` 和可选 shortcut records。File/image inputs 应引用 Cradle-owned asset records，不能直接依赖 arbitrary temp paths。

## 验收

- 运行 Prompt App 会产生正常 chat session 与 usage record。
- Required inputs 在生成开始前完成校验。
- Disabled app 不能通过 shortcut 或 URL 运行。
