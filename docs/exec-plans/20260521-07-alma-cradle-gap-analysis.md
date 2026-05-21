# Alma 与 Cradle 功能差异研究

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

本计划遵循 `docs/exec-plans/README.md` 所在目录的本地计划约定，以及 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 的 ExecPlan 要求。当前任务不是实现业务功能，而是从当前工作树证据中审计 `/Users/wibus/dev/safe-research/Alma-source` 的功能面，并与 `/Users/wibus/dev/Cradle` 的现有能力对比，最终给出至少 15 个“Alma 有、Cradle 尚未实现或未形成等价能力”的缺口点，并把 Alma 功能面继续拆成可执行 spec。

## Purpose / Big Picture

Wibus 需要知道 Alma 的功能全集里哪些能力值得 Cradle 借鉴，尤其是那些 Cradle 当前还没有的能力。完成后，读者可以查看 `docs/multi-work/alma-cradle-gap-analysis/` 下的交接文件和最终报告，看到每个缺口点对应的 Alma 证据、Cradle 反证或弱证据、缺口判断，以及对 Cradle 所有权边界的建议。继续规格化后，读者还可以查看 `docs/specs/alma-inspired/` 下的 spec，把每个 Alma 功能面转成后续实现前可评审的目标、owner、API/data 草案和验收口径。

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
- [x] (2026-05-20 19:13Z) 创建 `docs/specs/` 与 `docs/specs/alma-inspired/` 文档入口，并把综合报告中的缺口拆成首批 40 个 Alma-inspired specs。
- [x] (2026-05-20 19:18Z) 将首批 spec 中残留英文正文的 10 个文件改写为中文正文，保持 API path、identifier 和 owner path 使用英文。
- [x] (2026-05-20 19:23Z) 补充 `agent-crew-delegation`、`artifact-rendering`、`prompts-skills-hooks`、`desktop-update-about` 4 个规格，覆盖 renderer 功能清单中原先只被宽泛 spec 间接覆盖的功能面。
- [x] (2026-05-20 19:25Z) 新增 `docs/specs/alma-inspired/coverage-matrix.md`，把综合报告 12 类、ExplorationA 26 项、ExplorationB 22 项和最终 28 个缺口全部映射到 spec 文件。
- [x] (2026-05-20 19:27Z) 完成规格目录验证：`docs/specs/alma-inspired/` 共有 46 个 Markdown 文件，其中 44 个 feature specs；README 链接全部可解析；44 个 feature specs 均包含必备章节；覆盖矩阵没有“缺失”状态。

## Surprises & Discoveries

- Observation: Alma 目录当前没有常规 `src/` 源码树，也不是 Git 仓库形态；功能盘点必须从构建产物和依赖反推。
  Evidence: `docs/recovery-plan.md` 明确写到 workspace 不是 Git repository，`out/` 包含 packaged build output，未发现 source maps。
- Observation: Alma renderer 至少有八个独立 HTML 入口，不是单一窗口应用。
  Evidence: `out/renderer/index.html`、`notifications.html`、`lightbox.html`、`prompt-app-runner.html`、`livecoding.html`、`gallery.html`、`settings.html`、`share.html` 均存在并加载不同入口脚本。
- Observation: Alma package 依赖暴露了很多产品能力信号，包括本地 Whisper、HuggingFace Transformers、文档预览、Discord/飞书/微信、Playwright、Chromium BiDi、MCP、ACP、sqlite-vec、Strudel、PostHog、Sentry、electron-updater、native notifications。
  Evidence: `/Users/wibus/dev/safe-research/Alma-source/package.json` 的 dependencies 列表。
- Observation: 仅按最终 28 个缺口拆 spec 会遗漏 Alma renderer 清单中的 Agent Crew、Artifact rendering、Prompts/Skills/Hooks 和 About/update 这类“不是缺口表主项但属于 Alma 功能全集”的能力。
  Evidence: `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-renderer-product-ExplorationB.md` 的简明功能清单包含 Agent Crew、Artifact、Prompts/Skills/Hooks、About；因此补充了 4 个额外 spec。

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
- Decision: Alma-inspired spec 集合采用“功能全集覆盖”口径，而不是只覆盖最终缺口表。
  Rationale: 用户后续要求“全部功能拆解出来，一个个全部变成 spec”；因此需要覆盖综合报告的 12 类功能地图、ExplorationA 的 26 项主进程/系统功能、ExplorationB 的 22 项 renderer/产品功能，以及最终 28 个缺口。
  Date/Author: 2026-05-20 / Codex
- Decision: 对 Agent Crew、Artifact rendering、Prompts/Skills/Hooks 和 Desktop Update/About 建立独立 spec。
  Rationale: 这些功能在 Alma renderer 或系统清单中是明确产品面，若只放进 chat、workspace 或 desktop 的宽泛 spec，会降低后续实现前评审的可追溯性。
  Date/Author: 2026-05-20 / Codex

## Outcomes & Retrospective

2026-05-20 18:45Z：研究交付已完成。四个并行节点分别产出 Alma 主进程/系统、Alma renderer/产品、Cradle 后端/桌面、Cradle 前端/产品交接文件。主 Agent 已归并为最终综合报告，报告列出 Alma 功能地图、Cradle 覆盖地图、28 个差异点、推荐优先级和 owner/namespace 建议。最终报告满足用户要求的至少 15 个 Alma 有而 Cradle 未实现或未形成等价能力的点。

2026-05-20 19:25Z：规格化交付已完成。`docs/specs/alma-inspired/` 包含 44 个 feature specs、索引 README 和覆盖矩阵。覆盖矩阵证明综合报告 12 类功能地图、ExplorationA 26 项、ExplorationB 22 项以及最终 28 个缺口均已映射到具体 spec 文件。新增 specs 只定义目标和边界，不引入运行时代码或依赖。

2026-05-20 19:27Z：验证已通过。文件计数输出为 `46`，即 44 个 feature specs 加 README 与覆盖矩阵；链接验证输出 `46 markdown files passed link validation`；必备章节验证输出 `44 spec files passed required-section validation`；英文 section heading 检查和覆盖矩阵“缺失”状态检查均无命中。

## Context and Orientation

Alma 位于 `/Users/wibus/dev/safe-research/Alma-source`。当前可见证据包括 `package.json`、`docs/recovery-plan.md`、`out/main/index.js`、`out/main/chunks/*.js`、`out/preload/index.js`、`out/renderer/*.html`、`out/renderer/assets/*` 和 `node_modules`。`docs/recovery-plan.md` 表明这是 packaged Electron app 的恢复工作区，而不是完整源码树。`package.json` 表明 Alma 是一个 Electron 桌面应用，描述为 `AI Provider Management Desktop App`，入口为 `out/main/index.js`。

Cradle 位于 `/Users/wibus/dev/Cradle`。当前能力面包括 `apps/server/src/modules` 下的 HTTP/API 模块，`apps/web/src/features` 下的 React 产品功能，`apps/desktop` 下的 Electron 包装，`chronicle` 下的本地记录能力，以及 `packages`、`plugins`、`resources/skills` 等扩展与工具目录。Cradle 的关键架构约束是所有权和 namespace：可以读取其他产品 namespace 的数据，但不应写入其他产品 namespace；新能力应放到语义 owner 清晰的位置。

规格文档位于 `docs/specs/alma-inspired/`。每个 spec 都是后续实现前的产品/架构边界文件，而不是代码实现计划。`docs/specs/alma-inspired/README.md` 是索引，`docs/specs/alma-inspired/coverage-matrix.md` 是从 Alma 功能证据到 spec 文件的总映射。

交接文件必须写入 `docs/multi-work/alma-cradle-gap-analysis/`，命名采用 `20260521-<short-description>-<Agent-type><id>.md`。每份交接文件必须自包含，说明证据来源、结论、风险和不确定性。

## Plan of Work

第一步，主 Agent 创建本 ExecPlan，并启动多个并行研究节点。Alma 节点负责从 `out/main`、`out/preload`、`out/renderer` 和依赖中枚举功能，不负责判断 Cradle 是否实现。Cradle 节点负责从 `apps/server/src/modules`、`apps/web/src/features`、`apps/desktop`、`chronicle`、`plugins`、`packages` 中枚举现有能力，不负责夸大缺口。

第二步，主 Agent 收集交接文件后做交叉对比。每个候选缺口需要至少一条 Alma 正向证据，以及一条 Cradle 缺失证据或弱证据。缺失证据可以来自 `rg` 未命中、模块 README 未覆盖、API 模块缺失、前端 feature 缺失、desktop IPC 能力缺失等，但必须说明证据范围。

第三步，主 Agent 写入最终综合报告，报告位置为 `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md`。报告需要给出 Alma 功能地图、Cradle 覆盖地图、至少 15 个缺口点、优先级建议，以及后续如果要实现时的 owner/namespace 建议。

第四步，主 Agent 将综合报告和两个 Alma 探索交接文件中的功能清单拆成 `docs/specs/alma-inspired/` 下的 spec。每个 spec 至少包含目标、Alma 证据、Cradle 当前状态、Owner / Namespace、目标行为和验收。Cradle 已覆盖的能力也需要有 spec，用于说明 canonical owner 和不需要重复实现的边界。

第五步，主 Agent 新增覆盖矩阵，显式列出综合报告 12 类、ExplorationA 26 项、ExplorationB 22 项和最终 28 个缺口到 spec 文件的映射，矩阵中不允许出现 `missing`。

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

规格化阶段创建并维护：

    docs/specs/README.md
    docs/specs/alma-inspired/README.md
    docs/specs/alma-inspired/coverage-matrix.md
    docs/specs/alma-inspired/*.md

## Validation and Acceptance

验收标准是最终综合报告存在且自包含，能够让 Wibus 不打开其他文件也能理解结论。报告必须满足以下行为标准：

第一，报告列出 Alma 的主要功能地图，并对每类功能标注证据来源。第二，报告列出 Cradle 当前已有能力地图，避免把已有能力误判为缺口。第三，报告至少包含 15 个 Alma 有但 Cradle 缺的功能点，每个点都包含 Alma 证据、Cradle 当前状态、为什么算缺口、建议 owner/namespace、优先级。第四，所有子 Agent 交接文件都存在并符合命名约定。第五，最终报告中的缺口点经过主 Agent 复核，不能只复制子 Agent 原始结论。

可以用以下命令验证交付物存在：

    ls docs/multi-work/alma-cradle-gap-analysis
    rg -n "^##|^###|缺口|Evidence|证据|Alma|Cradle" docs/multi-work/alma-cradle-gap-analysis

规格化阶段的验收标准是：`docs/specs/alma-inspired/` 至少包含 44 个 feature specs，加上 README 和覆盖矩阵；README 中的相对链接全部能解析到实际文件；每个 feature spec 都包含 `## 目标`、`## Alma 证据`、`## Cradle 当前状态`、`## Owner / Namespace` 和 `## 验收`；覆盖矩阵不包含“缺失”状态；spec 文件不再保留 `## Goal`、`## Alma Evidence`、`## Cradle Current State`、`## Target Ownership`、`## Target Behavior`、`## API Sketch`、`## Data Model`、`## Acceptance` 等英文 section heading。

可以用以下命令验证规格化交付：

    find docs/specs/alma-inspired -maxdepth 1 -type f -name '*.md' | sort | wc -l
    node - <<'NODE'
    const fs = require('fs')
    const path = require('path')
    const dir = 'docs/specs/alma-inspired'
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.md'))
    const specFiles = files.filter(file => !['README.md', 'coverage-matrix.md'].includes(file))
    const required = ['## 目标', '## Alma 证据', '## Cradle 当前状态', '## Owner / Namespace', '## 验收']
    for (const file of specFiles) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      for (const heading of required) {
        if (!text.includes(heading)) throw new Error(`${file} missing ${heading}`)
      }
    }
    console.log(`${specFiles.length} spec files passed required-section validation`)
    NODE
    rg -n "## (Goal|Alma Evidence|Cradle Current State|Target Ownership|Target Behavior|API Sketch|Data Model|Acceptance)" docs/specs/alma-inspired || true
    rg -n "\| 缺失 \|" docs/specs/alma-inspired/coverage-matrix.md || true

## Idempotence and Recovery

本任务只创建文档，不修改 Alma 源目录或 Cradle 业务代码。重复运行只读搜索命令是安全的。若某个子 Agent 交接文件质量不足，主 Agent 应保留文件并新增复核或修订文件，不删除原始证据。若最终报告发现某个缺口证据不足，应将该点降级到“候选/不确定”，并补充新的已验证缺口，保证最终至少 15 个强证据点。

规格化阶段同样只创建和修改文档。重复运行验证脚本不会改变工作树。若覆盖矩阵发现遗漏，应优先新增或修订 spec，而不是把功能从矩阵里删除。若某个 spec 后续进入实现，应为该 spec 单独创建新的 ExecPlan，不在本研究计划里直接实现业务代码。

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

规格化阶段确认的交付形态：

    docs/specs/alma-inspired/README.md
    docs/specs/alma-inspired/coverage-matrix.md
    44 feature spec files under docs/specs/alma-inspired/

最终验证输出：

    46
    46 markdown files passed link validation
    44 spec files passed required-section validation
    no English section heading matches
    no coverage matrix missing-status matches

## Interfaces and Dependencies

本研究不引入运行时依赖。研究接口是文档交付物：

`docs/multi-work/alma-cradle-gap-analysis/20260521-*-Exploration*.md` 用于子 Agent 的独立发现；`docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md` 用于最终综合报告。每份文件都必须是 Markdown，自包含，正文使用中文，代码块和命令使用 English。

`docs/specs/alma-inspired/*.md` 用于后续按功能选择实现方向。Spec 的 body 使用中文，API path、module path、identifier 和 owner namespace 使用英文。覆盖矩阵是当前“全部 Alma 功能已规格化”的验收入口。

Revision note 2026-05-20: 创建初始 ExecPlan，用于协调 Alma 与 Cradle 功能差异研究，并记录 multi-work 的交接文件标准。

Revision note 2026-05-20: 更新 Progress 与 Outcomes，记录四个并行交接文件和最终综合报告已经完成，并明确最终缺口数量为 28 个。

Revision note 2026-05-20: 扩展本计划以覆盖规格化阶段，记录 44 个 Alma-inspired specs、coverage matrix、验证口径和索引更新。

Revision note 2026-05-20: 记录最终验证结果，并把覆盖状态检查更新为中文状态值。
