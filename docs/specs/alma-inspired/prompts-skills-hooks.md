# Prompts、Skills 与 Hooks

## 目标

Cradle 需要把 prompts、skills 和 hooks 的边界讲清楚：prompt 是用户可管理的 reusable instruction/template，skill 是 agent context package，hook 是受治理的 lifecycle extension。三者可以互相引用，但不能共享未定义的存储 namespace。

## Alma 证据

Alma renderer 功能清单包含 prompts management、skills 多来源分类和自动提取、hooks management。Alma plugin runtime 也包含 hooks 和 settings 证据。

## Cradle 当前状态

Cradle 已有 filesystem-first skills manager，覆盖 global、workspace、agent writable scopes，并能 import/export。Plugin governance 支持 hooks、commands、panels、MCP 和 skills registration。当前没有独立 prompts manager，也没有面向用户的 hooks management surface 与 Alma 完全等价。

## Owner / Namespace

`skills` 拥有 Cradle skills projection，并遵守不写入其他产品 namespace 的原则。未来 `prompts` 模块拥有 reusable prompt templates。`apps/server/src/plugins` 拥有 plugin hook registration 和 permission audit。Agent runtime 只读取被选择的 prompts、skills 和 hooks projection。

## 目标行为

- 用户可以管理 reusable prompts，并把 prompt 插入 chat、Prompt App 或 automation。
- Skills 继续按 global、workspace、agent scopes 管理，Cradle-only 写入走 Cradle namespace。
- Hooks 必须声明触发点、权限、输入输出和 failure behavior。
- Plugin-provided hooks 可以被禁用，并留下 audit record。

## API 草案

- `GET /prompts`
- `POST /prompts`
- `PUT /prompts/:id`
- `DELETE /prompts/:id`
- `GET /skills`
- `GET /plugins/hooks`
- `PUT /plugins/hooks/:id/enabled`

## 数据模型

Prompts 使用 Cradle-owned records，保存 title、body、variables、scope、tags 和 version。Skills 保持现有 filesystem-first ownership。Hooks 作为 plugin capability records 和 permission grants 的投影保存。

## 验收

- Prompt template 可以被 Prompt App 引用，但删除 prompt 时必须提示引用关系。
- Skill import/export 不写入外部 `.agents/skills` namespace。
- 禁用 hook 后，相关 plugin lifecycle extension 不再执行，但历史 audit 保留。
