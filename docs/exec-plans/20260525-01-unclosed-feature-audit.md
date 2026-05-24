# 审计 Cradle 未收口功能

本 ExecPlan 是一个活文档。随着工作推进，必须持续更新 `Progress`、`Surprises & Discoveries`、`Decision Log` 和 `Outcomes & Retrospective`。

本文档遵循 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 的 ExecPlan 规则。它刻意保持自包含，后续贡献者不需要读取聊天记录，也能从这个文件恢复本次审计。

## Purpose / Big Picture

Wibus 要求找出 Cradle 项目里尚未完全收口的功能。在本次审计里，“未收口功能”指的是：代码、路由、界面、文档、测试或命名已经暗示某项能力存在，但它没有完整的端到端路径，前后端契约不一致，仍有占位逻辑，缺少可验证的测试或文档闭环，或者所有权与命名空间边界不清。

本次工作的结果不是修代码，而是一份有证据、有分级、可复核的审计报告。报告会产出到 `docs/multi-work/unclosed-feature-audit/`，列出未完成或风险较高的功能区域，并给出相关文件与建议验证方式。

## Progress

- [x] (2026-05-24 17:07Z) 已阅读 `multi-work` skill，确认本任务适合使用 Strategy 1 DAG，因为服务端、前端与平台表面可以独立审计。
- [x] (2026-05-24 17:07Z) 已阅读 `execplan` skill 与 PLANS.md 规则，然后创建本计划。
- [x] (2026-05-24 17:07Z) 已检查当前工作区状态，确认存在用户已有改动。本次审计不得修改业务代码，只新增审计文档。
- [x] (2026-05-24 17:07Z) 已创建本 ExecPlan 与 multi-work 交接目录。
- [x] (2026-05-24 17:08Z) 已派发四个独立探索代理，分别覆盖服务端模块、前端功能、平台表面、全仓库 TODO/测试/文档信号。
- [x] (2026-05-24 17:09Z) 主代理已收集服务端模块清单、前端功能清单、Tab 入口清单，并运行横向关键词扫描作为后续综合校验材料。
- [x] (2026-05-24 17:22Z) 已收集四份探索交接文件，并确认文件位于 `docs/multi-work/unclosed-feature-audit/` 且命名符合本次约定。
- [x] (2026-05-24 17:25Z) 已综合所有发现，生成最终审计报告 `docs/multi-work/unclosed-feature-audit/20260525-final-unclosed-feature-audit-Main.md`。
- [x] (2026-05-24 17:26Z) 已完成主代理集成质量检查：重复发现已合并，剩余不确定性已在最终报告中单独列出。

## Surprises & Discoveries

- Observation: 当前工作区已经有大量修改，集中在 provider targets、provider sources、agent management、composer toolbar、chat 与 workspace detail 附近。
  Evidence: `git status --short` 报告了 `apps/server/src/modules/provider-targets`、`apps/server/src/modules/providers`、`apps/web/src/features/agent-management`、`apps/web/src/features/composer-toolbar`、`apps/web/src/features/chat` 以及 `pnpm-lock.yaml` 等文件存在修改。

- Observation: 横向关键词扫描不能直接作为结论，因为 `placeholder` 和 `throw new Error` 主要命中了正常 UI placeholder、测试断言和错误处理。
  Evidence: `rg -n "TODO|FIXME|HACK|not implemented|Not implemented|coming soon|Coming soon|placeholder|stub|test\\.skip|describe\\.skip|it\\.skip|test\\.todo|throw new Error\\("` 返回 528 行，其中大量结果来自输入框 placeholder、测试 helper 和预期错误分支。

## Decision Log

- Decision: 本次任务按只读功能闭环审计处理，不做功能实现。
  Rationale: 用户要求“找一下”未收口功能，并明确启动 multi-work。最安全的交付物是证据充分的报告；如果把发现和修复混在一起，会增加误触用户已有改动的风险。
  Date/Author: 2026-05-24 / Codex

- Decision: 将 DAG 拆成服务端模块、前端功能、平台与工具链表面、全仓库 TODO/测试/文档信号四条线。
  Rationale: 这些区域的证据来源基本独立，可以并行审计，不会共享写入范围。
  Date/Author: 2026-05-24 / Codex

- Decision: 审计交接文件使用中文正文，文件路径、命令、标识符保持英文。
  Rationale: 项目 AGENTS.md 要求 Markdown 文档正文使用中文，而代码、命令和标识符使用英文。
  Date/Author: 2026-05-24 / Codex

## Outcomes & Retrospective

审计仍在进行。所有交接文件收集并综合后，会在这里记录最终结果、剩余缺口和经验。

2026-05-24 17:26Z：审计已完成。最终报告确认了 13 个未收口点，并按 P1/P2/P3 分级。最优先的闭环方向是官方插件发行链路、Automation 前后端 contract、Chronicle builtin MCP、Home tab 产品语义、Plugin panel URL 恢复。所有结论均来自静态审计，本次没有运行测试、没有启动应用、没有打包桌面端。

## Context and Orientation

Cradle 是一个多包项目。服务端模块位于 `apps/server/src/modules/`。Web 应用功能位于 `apps/web/src/features/`。桌面端位于 `apps/desktop/`。CLI 和共享包位于 `packages/`。插件位于 `plugins/`。端到端测试位于 `e2e/`。文档分布在 `docs/`、`documentations/` 以及各功能目录下的 `README.md`。

仓库根目录 `AGENTS.md` 规定了所有权原则：每个功能都应该有清晰的 owner 和 namespace。Cradle 可以读取其他产品 namespace 下的数据，但不应该把生命周期由 Cradle 管理的数据写入其他产品 namespace。本次审计必须标记所有权、命名空间或生命周期边界不清的功能。

multi-work 交接规范要求所有子代理输出写入 `docs/multi-work/unclosed-feature-audit/{YYYYMMDD}-{short-description}-{Agent-type}{id}.md`。交接文件必须自包含，明确不确定性，并提供足够的人类复核证据。

## Plan of Work

第一步，向独立代理并行派发探索任务，且每个代理的审计范围互不重叠。服务端代理检查后端模块、路由、服务、模型、测试与模块 README。前端代理检查 UI 功能、hooks、路由集成、用户可见空状态和组件测试。平台代理检查桌面端、CLI、packages、plugins、e2e 与文档表面。信号代理扫描全仓库 TODO 类标记、占位 stub、跳过的测试、孤立入口和 README 声称但代码未闭合的能力。

第二步，收集交接文件并验证它们存在、命名符合规范、内容自包含。如果某个代理只返回聊天摘要而没有写文件，需要要求它补正为磁盘上的交接文件。

第三步，将独立发现综合成最终报告 `docs/multi-work/unclosed-feature-audit/20260525-final-unclosed-feature-audit-Main.md`。最终报告按严重程度排序，并区分已确认缺口与仍需运行时验证的疑似缺口。

## Concrete Steps

所有命令从 `/Users/wibus/dev/Cradle` 执行。

如果目录不存在，创建目录：

    mkdir -p docs/exec-plans docs/multi-work/unclosed-feature-audit

派发探索代理时，提示词必须指定输出文件路径和验收标准。不得要求子代理修改业务代码。

代理完成后，验证产物：

    find docs/multi-work/unclosed-feature-audit -maxdepth 1 -type f -name '20260525-*.md' -print | sort

抽查交接文件并综合：

    sed -n '1,220p' docs/multi-work/unclosed-feature-audit/<handoff-file>.md

## Validation and Acceptance

当以下条件满足时，本次审计可以验收：

每个探索范围在 `docs/multi-work/unclosed-feature-audit/` 下都有一个交接文件，且每个文件包含具体文件引用、严重程度、证据和建议验证方式。

存在最终综合报告 `docs/multi-work/unclosed-feature-audit/20260525-final-unclosed-feature-audit-Main.md`。该报告不依赖聊天记录，能让人直接理解最重要的未收口功能、为什么它未收口、相关文件在哪里、建议如何闭环。

本次审计不修改业务代码。已有用户改动保持原样。

## Idempotence and Recovery

本审计可以安全重复运行。它只创建或更新 `docs/exec-plans/` 与 `docs/multi-work/unclosed-feature-audit/` 下的文档。如果某个子代理失败或输出不完整，只重跑对应范围，并要求它覆盖或替换自己的交接文件。

如果审计过程中本地文件发生变化，不要回滚。记录工作区变化，并基于检查时的文件内容提供证据。

## Artifacts and Notes

初始仓库形态通过以下命令收集：

    rg --files -g 'AGENTS.md' -g 'README.md' -g 'package.json' -g 'pnpm-workspace.yaml' -g 'turbo.json' -g 'vite.config.*' -g 'tsconfig*.json' -g 'go.mod' -g 'Cargo.toml' | sort

初始工作区状态显示已有大量修改。本次审计必须避免修改这些业务文件。

## Interfaces and Dependencies

本审计依赖工作区内的标准 shell 工具，尤其是 `rg`、`find`、`sed` 和 `git status`。本审计还依赖 multi-agent 写出的 Markdown 交接文件。本工作不会修改运行时 API、数据库迁移或公共接口。

Revision note 2026-05-24: 初始化计划，用于协调 Wibus 请求的 multi-work 审计。

Revision note 2026-05-24: 将正文调整为中文，以符合项目 Markdown 文档约定。

Revision note 2026-05-24: 记录四份探索交接文件与最终综合报告已完成，并补充静态审计的验证边界。
