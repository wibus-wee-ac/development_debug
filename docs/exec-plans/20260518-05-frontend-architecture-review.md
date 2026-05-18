# Frontend Architecture Review With Multi-Work

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

本次工作不是实现功能，而是对 Cradle 前端相关架构进行并行审查，找出可以优化的最佳实践点、架构边界问题、长期维护风险和可验证的改进方向。完成后，Wibus 应该能得到一份按优先级排序的架构 review 报告，报告会引用每个子 agent 的 handoff 文件，并把发现转化为可以分阶段执行的改进建议。

可见结果是：`docs/multi-work/frontend-architecture-review/` 下存在多个自包含 handoff 文档，主 agent 最终输出一份合并后的中文报告，说明高优先级问题、建议改法、风险和验证方式。

## Progress

- [x] (2026-05-18 15:30Z) 已读取 `$multi-work` 技能规则，确认本任务适合 DAG 策略，并确认 DAG 需要先启用 ExecPlan。
- [x] (2026-05-18 15:30Z) 已读取 ExecPlan 规则，确认计划文件必须写入 `docs/exec-plans/`，handoff 文件必须写入 `docs/multi-work/frontend-architecture-review/`。
- [x] (2026-05-18 15:30Z) 已检查当前工作区状态，发现存在用户已有改动；本次 review 不修改业务代码，只允许新增/更新 review 文档。
- [x] (2026-05-18 15:31Z) 并行启动 6 个架构审查 agent，分别覆盖 tabs package、web shell/navigation、chat rendering blocks、state/data flow、design system 和 repository hygiene。
- [x] (2026-05-18 15:45Z) 收集所有 handoff 文件，检查命名、完整性和 scope。
- [x] (2026-05-18 15:48Z) 合并发现，准备输出最终架构 review 报告。

## Surprises & Discoveries

- Observation: 当前工作区已有多处未提交改动，包括 `apps/web/src/components/layout/app-header.tsx`、`apps/web/src/features/chat/tool-call-block.tsx`、`apps/web/src/features/chat/blocks/` 和 server pty 模块。
  Evidence: `git status --short` 显示多个 modified 和 untracked 路径。

- Observation: review 执行期间工作区继续出现额外业务改动，例如 skills、devtool、workspace detail、provider model selector 和 design-system docs 路径。
  Evidence: 合并前再次运行 `git status --short`，显示新增 modified/untracked 路径；本次 review 没有回滚或修改这些业务文件。

## Decision Log

- Decision: 使用 DAG 策略，而不是 Critique-Chain。
  Rationale: 用户明确要求“多个 agent”并“把所有可能优化的最佳实践地方找出来”；审查面可以按代码所有权边界并行拆分，适合独立探索后合并。
  Date/Author: 2026-05-18 / Main Agent.

- Decision: 本次只新增 review 文档，不改业务实现。
  Rationale: 用户请求是架构 review，不是实施修复；同时当前工作区已有用户改动，业务代码编辑会增加误覆盖风险。
  Date/Author: 2026-05-18 / Main Agent.

## Outcomes & Retrospective

已完成 6 个 handoff 文件并完成主 agent 合并。实际生成：

- `docs/multi-work/frontend-architecture-review/20260518-shell-navigation-ExplorationA.md`
- `docs/multi-work/frontend-architecture-review/20260518-tabs-package-ExplorationB.md`
- `docs/multi-work/frontend-architecture-review/20260518-chat-rendering-ExplorationC.md`
- `docs/multi-work/frontend-architecture-review/20260518-state-data-flow-ExplorationD.md`
- `docs/multi-work/frontend-architecture-review/20260518-design-system-ui-ExplorationE.md`
- `docs/multi-work/frontend-architecture-review/20260518-repo-hygiene-ExplorationF.md`

最高优先级结论集中在四类：shell/tab lifecycle correctness、tabs URL sync and persistence invariants、chat render plan ownership、frontend server-state cache ownership。残余风险是当前 working tree 在 review 期间持续变化，最终报告应被理解为基于 2026-05-18 当前工作区快照的架构审查，而不是 main branch 的稳定审计。

## Context and Orientation

Cradle 是一个 monorepo。当前审查聚焦前端和前端相邻包：

`apps/web` 是 React/Vite 前端应用，使用 TypeScript、React 19、TanStack Query、Zustand、TanStack Router、Tailwind CSS 和本仓库的 design-system 组件约定。`apps/web/src/components/ui/` 是基础 UI 组件，`apps/web/src/components/common/` 是跨 feature 的应用级组件，`apps/web/src/features/{domain}/` 是业务 feature 目录。

`packages/tabs-next` 是 workspace package，被 `apps/web` 依赖，用来承载 tab store、tab renderer、URL sync、navigation hook 和 tab bar UI。当前 IDE active file 是 `packages/tabs-next/src/components/tab-bar.tsx`。

当前打开或相关路径包括：

- `packages/tabs-next/src/components/tab-bar.tsx`
- `apps/web/src/components/layout/app-header.tsx`
- `apps/web/src/features/chat/tool-call-block.tsx`
- `apps/web/src/features/chat/blocks/edit-file-block.tsx`
- `apps/web/src/features/chat/blocks/read-files-block.tsx`
- `apps/web/src/features/chat/reasoning-block.tsx`
- `apps/web/src/features/chat/message-bubble.tsx`
- `apps/web/src/store/*.ts`
- `apps/web/src/tabs/*.tsx`

仓库规则要求 UI 遵循 design-system，Tailwind class 必须静态定义并使用 `cn()` 组合，domain-specific 组件应放在对应 feature 目录。仓库原则还强调 ownership 和 namespace：功能应有明确 owner，能读其他 namespace 的数据，但不应写入其他 owner 的 namespace。

## Plan of Work

主 agent 负责组织和合并，不让子 agent 直接向用户汇报。每个子 agent 只审查一个相对独立的范围，并把结果写入 `docs/multi-work/frontend-architecture-review/20260518-<short-description>-ExplorationX.md`。每份 handoff 必须自包含，至少包含 scope、files inspected、findings、severity、recommended changes、risks、validation。

并行审查节点如下：

Frontend Shell and Navigation agent 审查 `apps/web/src/components/layout/`、`apps/web/src/tabs/` 和 app shell 相关路径，重点看 ownership、navigation state、layout slot 边界、header 与 tab 系统耦合。

Tabs Package agent 审查 `packages/tabs-next/`，重点看 package API 边界、store 模型、renderer policy、URL sync、drag/drop 或 tab bar 交互、测试覆盖和对 `apps/web` 的耦合。

Chat Rendering agent 审查 `apps/web/src/features/chat/`，特别是 `tool-call-block.tsx`、`blocks/`、`message-bubble.tsx`、streaming handler 和 reducer，重点看渲染分层、block registry、类型边界、可测试性和性能。

State and Data Flow agent 审查 `apps/web/src/store/`、`apps/web/src/features/*/use-*.ts`、`apps/web/src/api-gen` 使用方式和 TanStack Query/Zustand 边界，重点看 server state 与 client state 混用、持久化、API ownership 和测试策略。

Design System and UI Consistency agent 审查 `apps/web/src/components/ui/`、`apps/web/src/styles.css`、feature UI 使用方式和 Tailwind class 规则，重点看动态 class、component placement、可访问性、视觉一致性和 shared UI 抽象。

Repository Hygiene agent 审查 README/header/test/build hygiene，重点看新增目录文档、generated/dist/node_modules 污染、package scripts、lint/typecheck/test 覆盖和可维护性流程。

主 agent 在所有节点完成后，读取 handoff 文件，合并重复项，按 severity 和 implementation cost 排序，输出给用户。

## Concrete Steps

从仓库根目录 `/Users/wibus/dev/Cradle` 执行：

    sed -n '1,240p' /Users/wibus/dev/Cradle/.agents/skills/multi-work/SKILL.md
    sed -n '1,260p' /Users/wibus/.agents/skills/execplan/SKILL.md
    sed -n '1,260p' /Users/wibus/.agents/skills/execplan/references/PLANS.md
    git status --short

然后创建 handoff 目录：

    mkdir -p docs/multi-work/frontend-architecture-review

再启动并行审查 agent。每个 agent 必须读取本 ExecPlan 和自己的目标文件，并写出 handoff 文件。

最后，主 agent 验证：

    find docs/multi-work/frontend-architecture-review -maxdepth 1 -type f | sort

## Validation and Acceptance

验收条件是：

每个并行审查 agent 都写出符合命名约定的 handoff 文件，路径形如 `docs/multi-work/frontend-architecture-review/20260518-<short-description>-ExplorationX.md`。

每份 handoff 文件必须自包含，且包含被审查文件列表、明确问题、严重级别、改进建议、风险和验证方式。

主 agent 的最终报告必须合并所有 handoff，去重后按优先级排序，并明确哪些是高优先级架构问题，哪些是中低优先级最佳实践改进。

本次 review 不要求运行完整测试，因为目标是审查而非修复；但最终报告必须给出推荐验证命令，例如 `pnpm --filter @cradle/web exec tsc --noEmit`、`pnpm --filter @cradle/web build`、相关 Vitest 命令和必要的 UI 人工检查。

## Idempotence and Recovery

本计划是只读审查加文档输出，重复执行是安全的。若某个 agent 未能写出 handoff 文件，主 agent 应重新派发该单一审查节点，而不是重跑全部节点。若工作区业务代码发生变化，主 agent 应在最终报告中说明 review 基于执行时的 working tree，而不是假设 main branch 状态。

## Artifacts and Notes

当前已知工作区状态摘要：

    M apps/server/src/modules/pty/index.ts
    M apps/server/src/modules/pty/model.ts
    M apps/server/src/modules/pty/pty.runtime.ts
    M apps/server/src/modules/pty/service.ts
    M apps/web/package.json
    M apps/web/src/components/layout/app-header.tsx
    M apps/web/src/features/chat/message-bubble.tsx
    M apps/web/src/features/chat/reasoning-block.tsx
    M apps/web/src/features/chat/tool-call-block.tsx
    M apps/web/src/features/new-chat/new-chat-page.tsx
    M apps/web/src/styles.css
    M pnpm-lock.yaml
    ?? apps/web/src/features/chat/blocks/

## Interfaces and Dependencies

本次 review 不新增运行时接口。文档接口是 handoff 文件约定：

- Directory: `docs/multi-work/frontend-architecture-review/`
- Filename: `20260518-<short-description>-ExplorationX.md`
- Required sections: `Scope`, `Files Inspected`, `Findings`, `Recommended Changes`, `Risks`, `Validation`, `Uncertainties`

Revision note: Initial review orchestration plan created on 2026-05-18 to satisfy the multi-work DAG prerequisite and coordinate parallel architecture review agents.

Revision note: Updated on 2026-05-18 after all six handoff files were produced and merged into the final architecture review report.
