# Linear-style documentation for Cradle

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

本计划遵循 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 的要求。它是 Cradle 文档专项工作的主计划文件；`docs/multi-work/linear-documentation/` 下的 handoff 文件是子任务证据，不替代本计划。

## Purpose / Big Picture

本次工作的目标是把 `documentations/` 从 Fumadocs 默认骨架推进到可发布的 Cradle 文档站：用户可以像阅读 Linear 文档一样，通过清晰的章节、短句、任务导向页面、侧栏分组、开发者入口和故障处理页理解 Cradle 的产品与开发者能力。完成后，读者应能从首页进入产品文档、开发者文档、配置说明、运行时说明、插件开发、API/CLI、桌面应用、任务看板、自动化、Chronicle、Slack bridge 等核心主题，并能用文档完成真实操作。

文档正文按仓库约束使用简体中文；代码块、路径、命令、接口名、frontmatter 字段和标识符使用 English。所谓 “Linear-style” 在本计划中指信息架构、页面节奏、解释口吻和导航策略，而不是复制 Linear 的具体文案。

## Progress

- [x] (2026-05-20 18:05Z) 读取 `$multi-work` 与 `execplan` 技能要求，确认需要主计划、并行 handoff、独立审查与最终集成。
- [x] (2026-05-20 18:05Z) 核对当前 `documentations/` 状态：存在 Fumadocs/Next 骨架，仅有 `index.mdx` 与 `test.mdx` 两个默认内容页。
- [x] (2026-05-20 18:05Z) 创建本 ExecPlan，固定目标、约束、并行研究节点和验收标准。
- [x] (2026-05-20 18:18Z) 并行完成五个研究节点，产出 `ExplorationA` 到 `ExplorationE` handoff 文件。
- [x] (2026-05-20 18:32Z) 完成第一轮 `documentations/content/docs/` 文档树、section `meta.json`、站点 shell 和 developer docs 写入。
- [x] (2026-05-20 18:39Z) 运行第一轮 `pnpm types:check` 和 `pnpm build`；构建通过后启动最终审查。
- [x] (2026-05-20 18:43Z) 最终覆盖审查 `ReviewF` 返回 FAIL，指出 plugin contracts、Slack bridge、browser-use、System Info、troubleshooting 和 ExecPlan 状态不足。
- [x] (2026-05-20 18:44Z) Fumadocs 审查 `ReviewG` 返回 FAIL，指出 frontmatter value language rule 和 `metadataBase` 质量问题。
- [x] (2026-05-20 18:51Z) 修复审查问题：frontmatter values 改为 English，移除错误 GitHub `metadataBase`，补 Slack bridge setup guide、browser-use tool matrix、System Info pages、plugin web/desktop/first-party contract pages、真实 error-code troubleshooting tables。
- [x] (2026-05-20 18:52Z) 重新运行 `cd documentations && pnpm types:check`，通过。
- [x] (2026-05-20 18:52Z) 重新运行 `cd documentations && pnpm build`，通过；Next 提示未设置 `metadataBase`，因没有权威 docs deployment origin，保留为非阻塞提示而不写入错误 URL。
- [x] (2026-05-21 04:11+08:00) `ReviewL` 指出 Fumadocs polish 仍 FAIL：`/docs/map` 只是静态 path map，没有消费 `extractedReferences`，且 visual components 有英文可见文案。
- [x] (2026-05-21 04:11+08:00) `ReviewM` 确认可用能力边界：当前安装包没有可直接 import 的官方 `GraphView`，PASS 标准应是用 `source.getPages()` 与 `page.data.extractedReferences` 生成真实 link graph。
- [x] (2026-05-21 04:11+08:00) 完成 `FixM`：新增 Fumadocs extracted-reference graph builder、交互式 force graph、`DocsLinkGraph` MDX 组件、`/docs/map` 真实链接图谱、OpenAPI route reference 边界说明，并将新增可见文案本地化。
- [x] (2026-05-21 04:11+08:00) 重新运行 `cd documentations && pnpm types:check`，通过。
- [x] (2026-05-21 04:11+08:00) 重新运行 `cd documentations && pnpm build`，通过；仅保留既有 `metadataBase` warning。
- [x] (2026-05-21 04:11+08:00) 用生产服务器 `pnpm exec next start -p 3211` 做浏览器 smoke：`/docs/map` 桌面和移动 canvas 非空，指标为 71 pages / 150 internal links / 162 extracted references / 0 unresolved references；`/docs`、developer、agents、Chronicle、Slack bridge、troubleshooting 页面均无 browser page errors。
- [x] (2026-05-21 04:11+08:00) 最终 Fumadocs polish 复审 `ReviewN` 返回 PASS；确认 ReviewL 的真实 link graph、graph UI、中文可见文案和 OpenAPI boundary 阻塞项全部关闭。

## Surprises & Discoveries

- Observation: `documentations/` 已经安装依赖并存在 `.source/source.config.mjs`、`app/api/search/route.ts` 和动态文档页，说明项目已初始化 Fumadocs，而不是空目录。
  Evidence: `find documentations -maxdepth 4 -type f` 显示 Fumadocs 相关路由、`source.config.ts`、`lib/source.ts` 和默认 MDX 页面。
- Observation: 当前工作树存在大量非本任务改动。
  Evidence: `git status --short` 显示 `apps/server/`、`apps/web/`、`chronicle/`、`packages/` 等多处修改和未跟踪文件。本任务不得回滚这些改动。
- Observation: Fumadocs/Shiki 当前语言集不支持 fenced code block language `env`。
  Evidence: `cd documentations && pnpm build` 在 `documentations/content/docs/integrations/slack-bridge.mdx` 的 ```env block 上失败，错误为 `ShikiError: Language env not found`。已改为 ```bash。
- Observation: Next 16 build 会在没有 `metadataBase` 时提示使用 `http://localhost:3000` 解析 social images。
  Evidence: `cd documentations && pnpm build` 通过，但输出多条 `metadataBase property in metadata export is not set` warning。此前把 `metadataBase` 指向 GitHub repository 被 `ReviewG` 判定为错误；当前没有权威 docs deployment origin，因此不填假 URL。
- Observation: Fumadocs 审查把 frontmatter values 也纳入 English 规则。
  Evidence: `ReviewG` 将中文 `title` / `description` 标为 P1；修复后 `awk` 扫描所有 `.mdx` frontmatter 中 `title` / `description` 的非 ASCII 值，输出为空。
- Observation: 当前 Fumadocs 版本没有可直接从 `fumadocs-ui` import 的官方 Graph View 组件。
  Evidence: `ReviewM` 检查本地包，未发现直接可用 export；`@fumadocs/cli add graph-view` 的模板依赖 `react-force-graph-2d` 和 `d3-force`，因此本次采用该模式作为本地组件，并让数据源来自 `source.getPages()` 与 `extractedReferences`。
- Observation: 并发运行 `fumadocs-mdx` 相关命令可能短暂把 `.source/server.ts` 置为 0 字节，导致 dev server HMR 留下 stale overlay error。
  Evidence: 一次并发验证期间 `documentations/.source/server.ts`、`browser.ts`、`dynamic.ts` 均为 0 字节；顺序运行 `cd documentations && pnpm exec fumadocs-mdx` 后文件恢复，随后 `pnpm types:check` 与 `pnpm build` 均通过。最终浏览器 smoke 改用 production server `3211`，无 page errors。

## Decision Log

- Decision: 使用 `$multi-work` 的 DAG 模式，而不是单线程完成研究和写作。
  Rationale: 用户明确要求高强度分工协作，并点名 Fumadocs 研究应交给 sub agent；Linear 用户文档、developer 文档、Fumadocs、Cradle 产品覆盖、Cradle 开发者覆盖彼此可以并行。
  Date/Author: 2026-05-20 / Codex
- Decision: 文档正文使用简体中文，但保留 Linear 的信息架构与写作哲学。
  Rationale: 仓库指令要求解释、讨论和 Markdown 正文使用简体中文，同时用户要求仿照 Linear 的文档风格。两者可以通过中文短句、任务导向结构、精确命名和简洁口吻同时满足。
  Date/Author: 2026-05-20 / Codex
- Decision: 主线程只拥有计划、监督、整合和最终审计；研究与覆盖盘点交给 sub agents。
  Rationale: 这符合用户关于 “主线程监督所有事情，不帮 sub agent 做事情” 的要求，也符合 `$multi-work` 的主代理职责。
  Date/Author: 2026-05-20 / Codex
- Decision: 不把 `metadataBase` 设置为 GitHub repository URL。
  Rationale: Next metadata base 应是文档站部署 origin；GitHub repo URL 会让 social images 和 canonical metadata 指向错误路径。当前仓库没有权威 docs deployment origin，保留 warning 比写错 URL 更安全。
  Date/Author: 2026-05-20 / Codex
- Decision: 将 developer plugin section 拆成 contract pages，而不是只保留 example page。
  Rationale: `ReviewF` 指出 plugin SDK 覆盖不能只列 examples；plugin authors 需要独立的 web API、desktop API、Browser Use、System Info contract pages 才能按 owner、namespace、lifecycle、validation 和 limits 工作。
  Date/Author: 2026-05-20 / Codex
- Decision: `/docs/map` 保留 curated reader path map，同时新增真实 Fumadocs link graph。
  Rationale: curated map 解释“应该如何理解 Cradle”，但用户要求图类能力和 ReviewL 要求真实消费 Fumadocs link references。新增 `DocsLinkGraph` 从 `source.getPages()`、`page.data.extractedReferences`、`source.getPageByHref()` 和 `source.resolveHref()` 构建 nodes、links、inbound/outbound counts 与 unresolved reference diagnostics，避免把静态卡片伪装成 graph。
  Date/Author: 2026-05-21 / Codex
- Decision: 不手写 OpenAPI route-level API reference。
  Rationale: 当前 OpenAPI 页面解释 contract ownership 与 lifecycle；逐 route reference 应由 server `/docs` Scalar UI 和 `/openapi.json` 提供。若未来迁入 Fumadocs，应从同一份 OpenAPI document 生成，避免文档、OpenAPI 和 generated CLI drift。
  Date/Author: 2026-05-21 / Codex

## Outcomes & Retrospective

当前已完成可构建的 Cradle 文档站内容树。`documentations/content/docs/` 已从 scaffold 扩展为 71 个 MDX 页面和 21 个 `meta.json` 文件，覆盖用户、管理员、运维和开发者场景。默认 `test.mdx` scaffold 已删除，`documentations/README.md` 已替换为 Cradle 文档站维护说明，站点 shell 已设置为 `Cradle Docs` 和 `zh-CN`。

多轮独立审查发现的阻塞问题已经修复：`ReviewF` 的 plugin contracts、Slack bridge、browser-use、System Info、troubleshooting 和 ExecPlan stale status 问题已补；`ReviewG` 的 frontmatter language rule 和错误 `metadataBase` 问题已处理；`ReviewL` 的 Fumadocs polish 问题已通过真实 extracted-reference graph、中文 visual copy、OpenAPI route reference boundary 修复。`cd documentations && pnpm types:check` 和 `cd documentations && pnpm build` 均已通过。生产服务器 smoke check 覆盖关键页面并通过。`ReviewN` 已 PASS。

## Context and Orientation

Cradle 是一个包含桌面端、Web 前端、服务器、插件、数据库包、CLI、Chronicle 录制/记忆管线和 Slack bridge 的 monorepo。当前文档站位于 `documentations/`，使用 Next.js 与 Fumadocs。主要文件包括 `documentations/source.config.ts`、`documentations/lib/source.ts`、`documentations/app/docs/[[...slug]]/page.tsx`、`documentations/app/docs/layout.tsx`、`documentations/app/llms.txt/route.ts` 和 `documentations/content/docs/`。

Fumadocs 是一个基于文件系统内容集合生成文档路由、侧栏树、搜索索引和 LLM 文本端点的文档框架。在本仓库中，`source.config.ts` 通过 `defineDocs({ dir: 'content/docs' })` 声明文档内容目录，`lib/source.ts` 通过 `loader()` 把 MDX 文件转成 Fumadocs 的页面树，`app/docs/layout.tsx` 用 `DocsLayout` 渲染侧栏与正文。

`documentations/content/docs/index.mdx` 和 `documentations/content/docs/test.mdx` 目前仍是模板文案。最终应删除或替换模板页，并建立覆盖 Cradle 用户、管理员、开发者和运维场景的文档树。若需要侧栏分组，应在相应目录放置 `meta.json`，并用 Fumadocs 支持的 frontmatter 字段描述标题、描述和排序。

本任务涉及外部研究：`https://linear.app/docs`、`https://linear.app/developers` 和 `https://www.fumadocs.dev/llms.txt`。外部内容只能用于提炼结构、风格和实现方式，不能复制长段原文。引用和 handoff 应使用概括。

## Plan of Work

第一阶段是并行研究。启动五个子任务：Linear 用户文档研究、Linear developer 文档研究、Fumadocs 实现研究、Cradle 产品文档覆盖盘点、Cradle 开发者文档覆盖盘点。每个子任务必须写入 `docs/multi-work/linear-documentation/20260521-<topic>-<Agent-type>.md`，文件必须自包含，包含证据、结论、风险和推荐落地方式。

第二阶段是主线程整合。读取所有 handoff 文件，整理 Linear-style 的写作哲学、页面模板、目录树和覆盖矩阵。把矩阵转换成 `documentations/content/docs/` 的目录结构。优先交付用户能直接阅读的文档，而不是只写内部计划。

第三阶段是实现。重写 `documentations/content/docs/` 下的 MDX 文件与 `meta.json`，必要时调整 `documentations/app/(home)/page.tsx`、`documentations/lib/layout.shared.tsx`、`documentations/components/mdx.tsx` 或 Fumadocs 配置。修改应保持可审阅，避免触碰与文档站无关的应用代码。

第四阶段是审查和修复。用 review sub agent 检查 Linear 风格一致性、Cradle 覆盖完整性、Fumadocs 可构建性和是否违反仓库 Markdown 语言规则。主线程根据 review 结果修复，并重新运行验证。

## Concrete Steps

在仓库根目录 `/Users/wibus/dev/Cradle` 执行：

    sed -n '1,240p' /Users/wibus/.agents/skills/multi-work/SKILL.md
    sed -n '1,260p' /Users/wibus/.agents/skills/execplan/references/PLANS.md
    find documentations -maxdepth 4 -type f | sort
    git status --short

创建计划文件后，启动并行 agents。每个 agent 的输出必须是 handoff Markdown 文件，不能只在聊天中总结。研究完成后，主线程读取 handoff 文件并实施文档站。

实现后，在 `documentations/` 中至少运行：

    pnpm types:check
    pnpm build

当前已经运行并通过：

    cd documentations
    pnpm types:check
    pnpm build

`pnpm build` 输出显示 `/docs`、`/llms.txt`、`/llms-full.txt`、`/llms.mdx/docs/.../content.md` 和 `/og/docs/.../image.png` 均生成静态或动态路由。构建警告仅为未设置 `metadataBase`，原因见 Decision Log。

Fumadocs graph smoke 已运行并通过：

    cd documentations
    pnpm exec next start -p 3211

    /docs/map production smoke:
    pages = 71
    internal links = 150
    extracted references = 162
    unresolved local references = 0
    desktop canvas = 802 x 544, non-empty
    mobile canvas = 324 x 480, non-empty

生产 smoke 页面：

    /docs
    /docs/map
    /docs/developers/overview
    /docs/agents/overview
    /docs/chronicle/overview
    /docs/integrations/slack-bridge
    /docs/troubleshooting

以上页面 browser page errors 均为空。

## Validation and Acceptance

验收需要逐项证明，而不是只凭文件数量判断。

第一，Linear-style 研究必须有证据：`docs/multi-work/linear-documentation/` 下存在独立 handoff 文件，分别覆盖 `https://linear.app/docs`、`https://linear.app/developers` 和 `https://www.fumadocs.dev/llms.txt`。这些文件要解释分区、布局、口吻、页面组成、开发者文档差异和可迁移到 Cradle 的写作规则。

第二，Cradle 覆盖必须有证据：handoff 或最终文档中列出 monorepo 的核心能力，并映射到文档页。覆盖范围至少包括 overview/get started、desktop app、web workspace、chat and agent runtime、providers and models、skills、plugins、approvals、git/workspace、kanban and issue agents、automation、Chronicle、session await、observability/devtools、server API、generated CLI、database ownership、plugin SDK、browser-use plugin、system-info plugin、Slack bridge、deployment/troubleshooting。

第三，Fumadocs 实现必须可用：`documentations/content/docs/` 包含合理目录树和 `meta.json`；`documentations/app/docs/[[...slug]]/page.tsx` 能读取页面；`/llms.txt` 与 `/llms-full.txt` 路由仍然可生成文本；文档站构建或类型检查通过。

第四，最终写作必须符合仓库约束：Markdown 正文使用简体中文，代码块、命令、路径、frontmatter 和标识符使用 English；不出现动态 Tailwind 修改；不改写无关业务代码；不回滚用户已有改动。

## Idempotence and Recovery

所有文档改动应通过添加或替换 `documentations/` 内文件完成，重复运行 Fumadocs 构建不应改变源文件。若并行 agent 输出冲突，主线程以本 ExecPlan 的覆盖矩阵和用户目标为准整合，不直接复制冲突内容。若构建失败，优先修复 MDX frontmatter、未导入组件、无效链接或 `meta.json` 排序问题。若发现某个 Cradle 能力仍无法从代码判断，应在文档中明确标注当前可验证的行为，不编造不存在的功能。

当前工作树有大量非本任务改动。恢复策略是只检查本任务触及文件的 diff，避免使用 `git reset --hard`、`git checkout --` 或删除非本任务文件。需要删除文档模板页时，只删除 `documentations/content/docs/test.mdx` 这类由当前文档站骨架产生且被新结构替代的文件。

## Artifacts and Notes

当前初始证据：

    documentations/content/docs/index.mdx
    documentations/content/docs/test.mdx
    documentations/source.config.ts
    documentations/lib/source.ts
    documentations/app/docs/[[...slug]]/page.tsx

当前完成证据：

    docs/multi-work/linear-documentation/20260521-linear-user-docs-ExplorationA.md
    docs/multi-work/linear-documentation/20260521-linear-developer-docs-ExplorationB.md
    docs/multi-work/linear-documentation/20260521-fumadocs-implementation-ExplorationC.md
    docs/multi-work/linear-documentation/20260521-cradle-product-coverage-ExplorationD.md
    docs/multi-work/linear-documentation/20260521-cradle-developer-coverage-ExplorationE.md
    docs/multi-work/linear-documentation/20260521-final-coverage-review-ReviewF.md
    docs/multi-work/linear-documentation/20260521-final-fumadocs-review-ReviewG.md
    documentations/content/docs/meta.json
    documentations/content/docs/developers/meta.json
    documentations/content/docs/integrations/system-info.mdx
    documentations/content/docs/developers/plugins/web-api.mdx
    documentations/content/docs/developers/plugins/desktop-api.mdx
    documentations/content/docs/developers/plugins/browser-use.mdx
    documentations/content/docs/developers/plugins/system-info.mdx
    documentations/lib/docs-graph.ts
    documentations/components/graph-view.tsx
    documentations/components/docs-link-graph.tsx
    documentations/content/docs/map.mdx
    docs/multi-work/linear-documentation/20260521-fumadocs-polish-capabilities-ExplorationK.md
    docs/multi-work/linear-documentation/20260521-fumadocs-polish-review-ReviewL.md
    docs/multi-work/linear-documentation/20260521-fumadocs-link-graph-review-M.md
    docs/multi-work/linear-documentation/20260521-fumadocs-polish-fixes-FixM.md

Validation transcripts:

    cd documentations && pnpm types:check
    [MDX] generated files ...
    ✓ Types generated successfully

    cd documentations && pnpm build
    ✓ Compiled successfully
    ✓ Generating static pages using 10 workers (216/216)
    /docs
    /llms-full.txt
    /llms.txt
    /llms.mdx/docs/[[...slug]]

当前风险：

    git status --short
    M apps/server/README.md
    M apps/web/src/app.tsx
    ...
    ?? documentations/

这说明 `documentations/` 是未跟踪目录，且仓库其他位置存在并行改动。本任务只能在必要范围内修改文档站，不得把其他改动当作自己的成果。

## Interfaces and Dependencies

文档站依赖 `fumadocs-mdx`、`fumadocs-core`、`fumadocs-ui`、Next.js 和 TypeScript。`documentations/source.config.ts` 必须继续导出 `docs` collection；`documentations/lib/source.ts` 必须继续导出 `source`、`getPageImage()`、`getPageMarkdownUrl()` 和 `getLLMText()`；`documentations/app/docs/layout.tsx` 必须继续把 `source.getPageTree()` 传给 `DocsLayout`。

最终文档内容目录应保留 Fumadocs 约定：每个页面是 `.mdx` 文件，每个分组可以有 `meta.json`。页面 frontmatter 至少包含 `title` 和 `description`。MDX 页面可以使用已有 `Cards`、`Card`、`Tabs`、`Callout` 等 Fumadocs 组件，但正文应保持 Linear 式短段落和任务导向，不堆砌营销式介绍。

Revision note: 2026-05-20 创建计划，原因是用户要求使用 `$multi-work` 深度研究 Linear 与 Fumadocs，并把 Cradle 文档完整写入 `documentations/`。

Revision note: 2026-05-20 18:52Z 更新计划，记录已完成的研究、实现、审查失败、修复、验证命令和剩余复审/smoke check，原因是 ExecPlan 需要作为当前状态的权威证据。

Revision note: 2026-05-21 04:11+08:00 更新计划，记录用户追加要求后的 Fumadocs polish 修复、真实 extracted-reference graph、生产 smoke 证据和 `ReviewN` PASS。
