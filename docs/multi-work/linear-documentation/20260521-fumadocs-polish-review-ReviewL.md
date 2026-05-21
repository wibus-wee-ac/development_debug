# ReviewL: Fumadocs polish review

## Verdict

FAIL

这轮改动明显比“补完整文档页”更进一步：`Steps`、`Tabs`、`Files`、`TypeTable` 和自定义 visual explainers 已经落到首页、developer overview、agents overview、Chronicle、OpenAPI、Plugin SDK、Slack bridge 和 troubleshooting 入口，读者理解路径有实质改善。

但当前状态还不能通过用户追加要求。主要阻塞点是 `/docs/map` 仍是手写静态关系卡片，不是基于 Fumadocs link references 或 Graph View 的 graph-like capability；同时新增 visual 组件把大量面向读者的正文写成英文，违反仓库文档正文使用简体中文的约束。

## Scope reviewed

- `docs/exec-plans/20260521-05-linear-style-documentation.md`
- `docs/multi-work/linear-documentation/20260521-fumadocs-polish-capabilities-ExplorationK.md`
- `git diff` 当前文档站改动
- `documentations/components/mdx.tsx`
- `documentations/components/docs-visuals.tsx`
- `documentations/source.config.ts`
- `documentations/app/global.css`
- `documentations/content/docs/index.mdx`
- `documentations/content/docs/map.mdx`
- `documentations/content/docs/getting-started/overview.mdx`
- `documentations/content/docs/developers/overview.mdx`
- `documentations/content/docs/developers/api/openapi.mdx`
- `documentations/content/docs/developers/plugins/sdk-overview.mdx`
- `documentations/content/docs/agents/overview.mdx`
- `documentations/content/docs/chronicle/overview.mdx`
- `documentations/content/docs/integrations/slack-bridge.mdx`
- `documentations/content/docs/troubleshooting/index.mdx`

## Validation run

通过：

```bash
cd documentations && pnpm types:check
```

通过：

```bash
cd documentations && pnpm build
```

构建生成了 `/docs/map`、`/llms.txt`、`/llms-full.txt` 和 `/llms.mdx/docs/map/content.md`。仍有既有 `metadataBase` warning；本轮不把它列为阻塞，因为 ExecPlan 已记录不写入错误部署 origin 的决策。

## Findings

### P1: `/docs/map` 不是 Fumadocs Graph View，也没有消费 link reference graph

证据：

- `documentations/source.config.ts:10-12` 启用了 `extractLinkReferences: true`。
- `documentations/content/docs/map.mdx:8` 只渲染 `<DocsKnowledgeGraph />`。
- `documentations/components/docs-visuals.tsx:617-681` 的 `DocsKnowledgeGraph` 使用静态 `docsGraphClusters` 数组渲染分组链接。
- 当前 diff 没有新增 `GraphView` 组件、graph data builder、`source.getPages()` link-reference 消费逻辑，也没有 Mermaid renderer。

影响：

用户明确要求“including graph-like capabilities”。当前页面视觉上像关系图入口，但它不是由 Fumadocs 文档链接关系生成，也不能揭示文档之间真实引用密度、孤岛页面、owner/recovery 路径或导航缺口。`extractLinkReferences` 被打开但没有被使用，容易形成“看起来有 graph，实际还是静态目录”的落差。

Required fix：

- 至少实现一个真实 graph-like 层：优先按 ExplorationK 建议接入 Fumadocs `Graph View`，用 `source.getPages()` 和 extracted link references 构建 `/docs/map` 的 graph data。
- 如果暂时不接官方 `Graph View`，也应明确把 `/docs/map` 降级命名为 path map，并新增基于 link references 的关系表、孤岛页检测或 inbound/outbound link sections，证明 `extractLinkReferences` 产生了理解价值。
- 首页的 `Open full map` 不应承诺 graph，除非 `/docs/map` 真正呈现 graph data。

### P1: 新增 visual explainers 的可见文案大量使用英文，违反文档正文语言约束

证据：

- `documentations/components/docs-visuals.tsx:136-178` 的首页系统卡片标题和描述均为英文，例如 `Desktop app`、`Starts the local server and owns desktop runtime boundaries.`
- `documentations/components/docs-visuals.tsx:617-640` 渲染 `Cradle docs graph`、`Start from a reader goal...`、`Open full map`。
- `documentations/content/docs/map.mdx:10-21` 使用 `How to read the map`、`First decision`、`System boundary` 等英文正文标题和英文路径名解释。
- 仓库约束要求解释、讨论、Markdown 正文使用简体中文；代码块、路径、命令、接口名、frontmatter 字段和标识符使用 English。这里的英文是最终页面可见正文，不是接口名或代码块。

影响：

这会让文档站风格在中文正文与英文 visual copy 之间断裂，尤其首页和 `/docs/map` 是最高流量入口。它也削弱了 Linear-style 的清晰短句效果，因为同一屏读者需要在两种语言之间切换。

Required fix：

- 把 `docs-visuals.tsx` 中所有面向读者的标题、描述、按钮、关系 label 改为简体中文；保留 `OpenAPI`、`CLI`、`plugin`、`runtime`、路径和接口名等技术标识原文。
- 把 `map.mdx` 的正文标题改为中文，例如 `如何阅读地图`、`先选路径`、`系统边界`、`下一步`。
- 修复后抽查首页、`/docs/map`、developer overview、troubleshooting 入口，确认首屏可见正文语言一致。

### P2: 自定义 cards 存在移动端布局和可读性风险

证据：

- `documentations/components/docs-visuals.tsx:520` 的 `VisualCard` 使用 `min-h-32`、`gap-3`、`p-4`。
- `documentations/components/docs-visuals.tsx:538-560` 的 `FlowLane` 在 `md` 以上横向铺开，且每个 item 还有内部箭头 wrapper。
- `documentations/components/docs-visuals.tsx:647` 的 graph cluster 在 `sm` 以上固定为 `7rem + content` 双列。

影响：

这些组件目前能构建，但没有截图或浏览器 smoke evidence。长英文描述改为中文后，部分卡片可能变高；`FlowLane` 在中等宽度上横向压缩 4-5 个节点，可能出现拥挤、换行过多或箭头与卡片视觉断裂。对于首页、agents overview、Chronicle overview、Slack bridge 这类入口页，布局风险会直接影响理解效率。

Required fix：

- 用本地 docs server 在桌面和移动宽度检查首页、`/docs/map`、agents overview、Chronicle overview、Slack bridge、troubleshooting。
- 对 4 个以上节点的 `FlowLane` 考虑在 `lg` 才横向排列，`md` 保持两列或纵向。
- 保持卡片高度由内容自然撑开，但避免把首屏堆得过长；首页可只保留一个主视觉 map，把 reader paths 下移。

### P2: Fumadocs component adoption 有效，但 OpenAPI 仍不是 API reference 级能力

证据：

- `documentations/content/docs/developers/api/openapi.mdx` 已加入 `<ApiToCliFlow />`、`<Steps>`、`<TypeTable>`、`<Tabs>`。
- 当前没有 `fumadocs-openapi`、generated route pages 或基于 `apps/server/src/http/openapi.ts` 的 reference tree。

影响：

OpenAPI 页面从浅文本升级为 contract lifecycle 页面，这是正向改进；但它仍然不能替代 API reference。用户要求的是持续提升 user/developer comprehension，OpenAPI 对开发者是高价值入口，缺少 route-level discovery 会让读者仍需跳出文档站看 server docs 或 live API UI。

Required fix：

- 本轮可接受作为非阻塞后续，但应在页面内明确 `Current docs explain the contract lifecycle; route-level reference is still served by server API UI`，避免读者误以为这里已有完整 API reference。
- 下一轮建议接入 `fumadocs-openapi` 或生成 `developers/api/routes/**` 页面。

## Positive evidence

- `documentations/components/mdx.tsx` 已注册 `Accordion`、`Files`、`Steps`、`Tabs`、`TypeTable` 和自定义 visual components，MDX 表达能力明显提升。
- `index.mdx` 用系统 map、reader path 和 role tabs 重写入口，比原先卡片目录更接近“按读者目标导航”。
- `developers/overview.mdx` 增加 architecture map、owner contract matrix 和 repo file tree，能更快传达 owner/namespace 体系。
- `agents/overview.mdx` 用 runtime flow、TypeTable、Steps 和 Tabs 解释 provider/model/runtime/agent identity 的关系，不再只是对象罗列。
- `chronicle/overview.mdx` 用 pipeline flow 和 settings tabs 解释 capture 到 memory 的过程，对跨运行时能力更友好。
- `integrations/slack-bridge.mdx` 的 flow、setup steps、scope table 和 troubleshooting table 明显提升可操作性。
- `troubleshooting/index.mdx` 的 diagnostic router 和 symptom matrix 是合适的 Fumadocs/UI 用法，入口页不再只是浅文本。
- `global.css` 的 `text-wrap`、font smoothing 和 code ligatures 是轻量 polish，没有引入动态 Tailwind。

## Required fixes before PASS

1. 把 `/docs/map` 从静态 path map 升级为真实 graph-like capability，或明确降级命名并消费 `extractLinkReferences` 产出可验证的 link graph value。
2. 把 `docs-visuals.tsx` 和 `map.mdx` 的可见解释文案改为简体中文，保留必要技术标识英文。
3. 对首页、`/docs/map`、developer overview、agents overview、Chronicle overview、Slack bridge、troubleshooting 做桌面和移动 smoke check，修复卡片或 flow layout 拥挤问题。
4. 在 OpenAPI 页面明确当前能力边界，或接入 route-level reference。

完成以上修复并重新通过：

```bash
cd documentations && pnpm types:check
cd documentations && pnpm build
```

即可进入下一轮 PASS 复审。
