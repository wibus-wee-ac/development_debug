# Alma 与 Cradle 功能差异研究

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

本计划遵循 `docs/exec-plans/README.md` 所在目录的本地计划约定，以及 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 的 ExecPlan 要求。当前任务不是实现业务功能，而是从当前工作树证据中审计 `/Users/wibus/dev/safe-research/Alma-source` 的功能面，并与 `/Users/wibus/dev/Cradle` 的现有能力对比，最终给出至少 15 个“Alma 有、Cradle 尚未实现或未形成等价能力”的缺口点。

## Purpose / Big Picture

Wibus 需要知道 Alma 的功能全集里哪些能力值得 Cradle 借鉴，尤其是那些 Cradle 当前还没有的能力。完成后，读者可以查看 `docs/multi-work/alma-cradle-gap-analysis/` 下的交接文件和最终报告，看到每个缺口点对应的 Alma 证据、Cradle 反证或弱证据、缺口判断，以及对 Cradle 所有权边界的建议。

这项工作使用 `multi-work` 的并行研究模式。主 Agent 负责计划、拆分、归并和最终判断；子 Agent 分别盘点 Alma 主进程与系统能力、Alma renderer 与用户功能、Cradle 后端/桌面能力、Cradle 前端/产品能力，并产出可独立阅读的交接文件。

## Progress

- [x] (2026-05-20 18:31Z) 读取 `multi-work` 和 `execplan` 技能要求，确认本任务应使用 DAG 式并行研究，并需要计划文件与交接文件。
- [x] (2026-05-20 18:31Z) 初步检查 Alma 目录，确认该目录不是完整源码树，而是包含 `package.json`、少量文档、`out/main`、`out/preload`、`out/renderer`、`node_modules` 的 Electron 构建产物。
- [x] (2026-05-20 18:31Z) 初步检查 Cradle 目录，确认当前项目包含 `apps/server/src/modules`、`apps/web/src/features`、`apps/desktop`、`packages`、`plugins`、`chronicle` 等能力面。
- [x] (2026-05-20 18:37Z) 并行产出 Alma 主进程/系统能力交接文件：`docs/multi-work/alma-cradle-gap-analysis/20260521-alma-main-system-ExplorationA.md`。
- [x] (2026-05-20 18:37Z) 并行产出 Alma renderer/用户功能交接文件：`docs/multi-work/alma-cradle-gap-analysis/20260521-alma-renderer-product-ExplorationB.md`。
- [x] (2026-05-20 18:40Z) 并行产出 Cradle 后端/桌面能力交接文件：`docs/multi-work/alma-cradle-gap-analysis/20260521-cradle-backend-desktop-ExplorationC.md`。
- [x] (2026-05-20 18:37Z) 并行产出 Cradle 前端/产品能力交接文件：`docs/multi-work/alma-cradle-gap-analysis/20260521-cradle-frontend-product-ExplorationD.md`。
- [x] (2026-05-20 18:45Z) 归并、去重和复核候选差异，形成 28 个 Alma 有而 Cradle 缺失或弱覆盖的点，其中 18 个为明确缺失。
- [x] (2026-05-20 18:45Z) 写入最终 `multi-work` 综合报告：`docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md`。

## Surprises & Discoveries

- Observation: Alma 目录当前没有常规 `src/` 源码树，也不是 Git 仓库形态；功能盘点必须从构建产物和依赖反推。
  Evidence: `docs/recovery-plan.md` 明确写到 workspace 不是 Git repository，`out/` 包含 packaged build output，未发现 source maps。
- Observation: Alma renderer 至少有八个独立 HTML 入口，不是单一窗口应用。
  Evidence: `out/renderer/index.html`、`notifications.html`、`lightbox.html`、`prompt-app-runner.html`、`livecoding.html`、`gallery.html`、`settings.html`、`share.html` 均存在并加载不同入口脚本。
- Observation: Alma package 依赖暴露了很多产品能力信号，包括本地 Whisper、HuggingFace Transformers、文档预览、Discord/飞书/微信、Playwright、Chromium BiDi、MCP、ACP、sqlite-vec、Strudel、PostHog、Sentry、electron-updater、native notifications。
  Evidence: `/Users/wibus/dev/safe-research/Alma-source/package.json` 的 dependencies 列表。

## Decision Log

- Decision: 使用当前工作树作为权威证据，不依赖网络查询 Alma upstream。
  Rationale: 用户指定了本地 `/Users/wibus/dev/safe-research/Alma-source`，目标是“看看 Alma 的所有功能”并和当前项目对比；当前目录中的构建产物足以提供功能证据，网络源可能与本地版本 `0.0.792` 不一致。
  Date/Author: 2026-05-20 / Codex
- Decision: 对缺口判定采用“能力等价”标准，而不是只看是否有同名模块。
  Rationale: Alma 与 Cradle 的命名、架构和所有权边界不同；有些 Cradle 能力可能不同名但等价，有些同名依赖可能尚未产品化。最终报告必须说明证据强度。
  Date/Author: 2026-05-20 / Codex
- Decision: 最终报告优先给出至少 15 个“Cradle 当前缺”的点，不把 Cradle 已经实现且只是交互形态不同的能力算作缺口。
  Rationale: 用户明确要求找出 Alma 有但 Cradle 没有的点，数量至少 15 个；报告应避免用泛泛差异凑数。
  Date/Author: 2026-05-20 / Codex

## Outcomes & Retrospective

2026-05-20 18:45Z：研究交付已完成。四个并行节点分别产出 Alma 主进程/系统、Alma renderer/产品、Cradle 后端/桌面、Cradle 前端/产品交接文件。主 Agent 已归并为最终综合报告，报告列出 Alma 功能地图、Cradle 覆盖地图、28 个差异点、推荐优先级和 owner/namespace 建议。最终报告满足用户要求的至少 15 个 Alma 有而 Cradle 未实现或未形成等价能力的点。

## Context and Orientation

Alma 位于 `/Users/wibus/dev/safe-research/Alma-source`。当前可见证据包括 `package.json`、`docs/recovery-plan.md`、`out/main/index.js`、`out/main/chunks/*.js`、`out/preload/index.js`、`out/renderer/*.html`、`out/renderer/assets/*` 和 `node_modules`。`docs/recovery-plan.md` 表明这是 packaged Electron app 的恢复工作区，而不是完整源码树。`package.json` 表明 Alma 是一个 Electron 桌面应用，描述为 `AI Provider Management Desktop App`，入口为 `out/main/index.js`。

Cradle 位于 `/Users/wibus/dev/Cradle`。当前能力面包括 `apps/server/src/modules` 下的 HTTP/API 模块，`apps/web/src/features` 下的 React 产品功能，`apps/desktop` 下的 Electron 包装，`chronicle` 下的本地记录能力，以及 `packages`、`plugins`、`resources/skills` 等扩展与工具目录。Cradle 的关键架构约束是所有权和 namespace：可以读取其他产品 namespace 的数据，但不应写入其他产品 namespace；新能力应放到语义 owner 清晰的位置。

交接文件必须写入 `docs/multi-work/alma-cradle-gap-analysis/`，命名采用 `20260521-<short-description>-<Agent-type><id>.md`。每份交接文件必须自包含，说明证据来源、结论、风险和不确定性。

## Plan of Work

第一步，主 Agent 创建本 ExecPlan，并启动多个并行研究节点。Alma 节点负责从 `out/main`、`out/preload`、`out/renderer` 和依赖中枚举功能，不负责判断 Cradle 是否实现。Cradle 节点负责从 `apps/server/src/modules`、`apps/web/src/features`、`apps/desktop`、`chronicle`、`plugins`、`packages` 中枚举现有能力，不负责夸大缺口。

第二步，主 Agent 收集交接文件后做交叉对比。每个候选缺口需要至少一条 Alma 正向证据，以及一条 Cradle 缺失证据或弱证据。缺失证据可以来自 `rg` 未命中、模块 README 未覆盖、API 模块缺失、前端 feature 缺失、desktop IPC 能力缺失等，但必须说明证据范围。

第三步，主 Agent 写入最终综合报告，报告位置为 `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md`。报告需要给出 Alma 功能地图、Cradle 覆盖地图、至少 15 个缺口点、优先级建议，以及后续如果要实现时的 owner/namespace 建议。

## Concrete Steps

在 `/Users/wibus/dev/Cradle` 下运行以下只读命令收集证据：

    find /Users/wibus/dev/safe-research/Alma-source -maxdepth 4 -type f -not -path '*/node_modules/*' -print
    sed -n '1,260p' /Users/wibus/dev/safe-research/Alma-source/package.json
    find /Users/wibus/dev/Cradle/apps/server/src/modules -maxdepth 2 -type f
    find /Users/wibus/dev/Cradle/apps/web/src/features -maxdepth 3 -type f
    rg -n "whisper|transformers|discord|lark|weixin|playwright|bidi|notification|gallery|lightbox|share|prompt-app|livecoding|sqlite-vec|embedding|vector|sentry|posthog|updater|mcp|acp" /Users/wibus/dev/safe-research/Alma-source/out /Users/wibus/dev/Cradle

启动并行研究后，每个子 Agent 需要创建对应交接文件：

    docs/multi-work/alma-cradle-gap-analysis/20260521-alma-main-system-ExplorationA.md
    docs/multi-work/alma-cradle-gap-analysis/20260521-alma-renderer-product-ExplorationB.md
    docs/multi-work/alma-cradle-gap-analysis/20260521-cradle-backend-desktop-ExplorationC.md
    docs/multi-work/alma-cradle-gap-analysis/20260521-cradle-frontend-product-ExplorationD.md

主 Agent 最后创建：

    docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md

## Validation and Acceptance

验收标准是最终综合报告存在且自包含，能够让 Wibus 不打开其他文件也能理解结论。报告必须满足以下行为标准：

第一，报告列出 Alma 的主要功能地图，并对每类功能标注证据来源。第二，报告列出 Cradle 当前已有能力地图，避免把已有能力误判为缺口。第三，报告至少包含 15 个 Alma 有但 Cradle 缺的功能点，每个点都包含 Alma 证据、Cradle 当前状态、为什么算缺口、建议 owner/namespace、优先级。第四，所有子 Agent 交接文件都存在并符合命名约定。第五，最终报告中的缺口点经过主 Agent 复核，不能只复制子 Agent 原始结论。

可以用以下命令验证交付物存在：

    ls docs/multi-work/alma-cradle-gap-analysis
    rg -n "^##|^###|缺口|Evidence|证据|Alma|Cradle" docs/multi-work/alma-cradle-gap-analysis

## Idempotence and Recovery

本任务只创建文档，不修改 Alma 源目录或 Cradle 业务代码。重复运行只读搜索命令是安全的。若某个子 Agent 交接文件质量不足，主 Agent 应保留文件并新增复核或修订文件，不删除原始证据。若最终报告发现某个缺口证据不足，应将该点降级到“候选/不确定”，并补充新的已验证缺口，保证最终至少 15 个强证据点。

## Artifacts and Notes

已确认 Alma 包元数据：

    name: alma
    version: 0.0.792
    description: AI Provider Management Desktop App
    main: out/main/index.js

已确认 Alma renderer 入口：

    index.html
    notifications.html
    lightbox.html
    prompt-app-runner.html
    livecoding.html
    gallery.html
    settings.html
    share.html

已确认 Cradle 的主要能力目录：

    apps/server/src/modules
    apps/web/src/features
    apps/desktop
    chronicle
    packages
    plugins

## Interfaces and Dependencies

本研究不引入运行时依赖。研究接口是文档交付物：

`docs/multi-work/alma-cradle-gap-analysis/20260521-*-Exploration*.md` 用于子 Agent 的独立发现；`docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md` 用于最终综合报告。每份文件都必须是 Markdown，自包含，正文使用中文，代码块和命令使用 English。

Revision note 2026-05-20: 创建初始 ExecPlan，用于协调 Alma 与 Cradle 功能差异研究，并记录 multi-work 的交接文件标准。

Revision note 2026-05-20: 更新 Progress 与 Outcomes，记录四个并行交接文件和最终综合报告已经完成，并明确最终缺口数量为 28 个。
