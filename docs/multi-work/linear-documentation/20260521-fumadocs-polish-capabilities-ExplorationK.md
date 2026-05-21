# ExplorationK: Fumadocs polish capabilities for Cradle docs

## 结论

当前 `documentations/` 已经是可构建的 Fumadocs/Next 文档站，但 Fumadocs 能力使用偏浅。用户想要的“更快理解 Cradle”的关键缺口不是再加更多正文，而是把现有 70+ 页变成可浏览的知识结构：入口卡片、任务步骤、文件树、类型表、API contract、依赖图和运行流图。

最高优先级建议是分两层推进：

1. 立即升级 MDX 表达能力：把 `Tabs`、`Steps`、`Files`、`TypeTable` 注册到 `documentations/components/mdx.tsx`，然后改造首页、developer overview、OpenAPI、plugin SDK、provider/runtime、Chronicle、Slack bridge、troubleshooting 等高入口页面。
2. 单独落地 graph-like 能力：先做 Fumadocs `Graph View` 页面/区域，再补 Mermaid 架构图。`Graph View` 需要配置 `extractLinkReferences` 并生成 graph data；Mermaid 需要新增 renderer 依赖或选用 server renderer。

## 已读证据

- ExecPlan：`docs/exec-plans/20260521-05-linear-style-documentation.md`
- 文档站入口：`documentations/app/docs/[[...slug]]/page.tsx`
- 文档布局：`documentations/app/docs/layout.tsx`
- MDX component registry：`documentations/components/mdx.tsx`
- 内容源：`documentations/source.config.ts`
- Fumadocs source loader：`documentations/lib/source.ts`
- package：`documentations/package.json`
- 内容树：`documentations/content/docs/**`
- OpenAPI server 证据：`apps/server/src/http/openapi.ts`

## Fumadocs 官方能力依据

- `llms.txt`：`https://www.fumadocs.dev/llms.txt`
- Graph View：`https://www.fumadocs.dev/docs/ui/components/graph-view`
- Mermaid：`https://www.fumadocs.dev/docs/markdown/mermaid`
- Components overview：`https://www.fumadocs.dev/docs/ui/components`
- Tabs：`https://www.fumadocs.dev/docs/ui/components/tabs`
- Files：`https://www.fumadocs.dev/docs/ui/components/files`
- Steps：`https://www.fumadocs.dev/docs/ui/components/steps`
- Type Table：`https://www.fumadocs.dev/docs/ui/components/type-table`
- Loader API：`https://www.fumadocs.dev/docs/headless/source-api`
- OpenAPI example：`https://www.fumadocs.dev/docs/openapi`

官方关键点：

- Fumadocs default MDX components 包含 `Cards`、`Callout`、code blocks、headings/table；当前仓库已经通过 `fumadocs-ui/mdx` 使用这些能力。
- `Graph View` 官方要求先运行 Fumadocs CLI 添加本地组件，并在 Fumadocs MDX postprocess 中启用 `extractLinkReferences`。
- Mermaid 官方没有内置 wrapper，建议直接使用 `mermaid` 或 `beautiful-mermaid`，也可以通过 `remarkMdxMermaid` 把 fenced `mermaid` blocks 转成 MDX 组件。
- `Tabs` 支持 `groupId`、`persist`、`updateAnchor`，适合把 Web/Desktop、user/developer、CLI/API 放在同页比较。
- `Files` 可直接用 React component，也可通过 `remark-mdx-files` 支持 fenced `files` code blocks。
- `Steps` 适合 setup、runbook、approval flow、migration flow。
- `TypeTable` 适合稳定 contract，不适合长篇叙述。

## 当前仓库立即可用的能力

这些能力不需要改依赖，最多只改 MDX 内容。

| Capability | 当前状态 | 适用位置 |
| --- | --- | --- |
| `Cards` / `Card` | 已由 `fumadocs-ui/mdx` 默认注册，`index.mdx` 和 troubleshooting index 已使用 | 首页、developer overview、section overview |
| `Callout` | 已默认注册，`index.mdx` 已使用 | 风险、限制、owner boundary、human-in-the-loop 提醒 |
| code blocks + Shiki | 已可用，但 Shiki 不支持任意 language；此前 `env` 失败过 | commands、config、route examples |
| tables | 已默认渲染 | error code matrix、route matrix、owner matrix |
| relative links | `page.tsx` 已用 `createRelativeLink(source, page)` | 所有 MDX 相对链接 |
| `MarkdownCopyButton` | `page.tsx` 已启用 | 每页复制 Markdown |
| `ViewOptionsPopover` | `page.tsx` 已启用 | GitHub/link options |
| `llms.txt` / `llms-full.txt` | route 已存在 | AI-readable docs |
| page tree + `meta.json` | `DocsLayout tree={source.getPageTree()}` 已启用 | 侧栏结构和 section ordering |
| lucide icon metadata | `lib/source.ts` 已启用 `lucideIconsPlugin()` | `meta.json` / frontmatter icon polish |

## 需要小配置改动但不一定需要新依赖的能力

这些能力在 `fumadocs-ui` 包内已经存在，但当前没有暴露给 MDX。

| Capability | 需要改动 | 推荐用途 |
| --- | --- | --- |
| `Tabs` / `Tab` | 在 `documentations/components/mdx.tsx` 导入并 spread `fumadocs-ui/components/tabs` | 同页切换 `User` / `Admin` / `Developer`、`Web` / `Desktop`、`HTTP` / `CLI` |
| `Steps` / `Step` | 在 `documentations/components/mdx.tsx` 注册 `fumadocs-ui/components/steps` | getting started、provider setup、Chronicle setup、Slack bridge setup |
| `Files` / `Folder` / `File` | 在 `documentations/components/mdx.tsx` 注册 `fumadocs-ui/components/files` | monorepo map、plugin directory map、docs authoring map |
| `TypeTable` | 在 `documentations/components/mdx.tsx` 注册 `fumadocs-ui/components/type-table` | plugin manifest、capability object、`x-cradle-cli` metadata、OpenAPI owner table |
| `remarkMdxFiles` | 在 `documentations/source.config.ts` 添加 remark plugin | 让 fenced `files` blocks 自动渲染为 file tree |

最小代码触点：

- `documentations/components/mdx.tsx`
- `documentations/source.config.ts`，仅当启用 `remarkMdxFiles` 时需要

## 需要依赖或较大配置变更的能力

| Capability | 为什么需要 | 可能触点 |
| --- | --- | --- |
| Fumadocs `Graph View` | 官方要求 `npx @fumadocs/cli add graph-view` 生成本地 `GraphView`，并启用 `extractLinkReferences` | `documentations/components/graph-view.tsx`、`documentations/lib/build-graph.ts`、`documentations/source.config.ts`、`documentations/app/docs/layout.tsx` 或新 MDX 页面 |
| Mermaid diagrams | 官方不内置 renderer；需要 `mermaid next-themes` 或 `beautiful-mermaid`，再注册 `Mermaid` | `documentations/package.json`、`documentations/components/mdx/mermaid.tsx`、`documentations/components/mdx.tsx`、`documentations/source.config.ts` |
| fenced `mermaid` blocks | 需要 `remarkMdxMermaid` 配置，把 code fence 转成 component | `documentations/source.config.ts` |
| OpenAPI generated docs | 当前只有 Cradle 自己的 `/openapi.json` 文档说明，没有 Fumadocs OpenAPI pages；通常需要 `fumadocs-openapi` 或 generator 接入 | `documentations/package.json`、`documentations/lib/source.ts`、`documentations/content/docs/developers/api/**`、可能新增 generated content |
| API reference with Scalar-style route pages | 需要把 server OpenAPI document 转为 page tree 或嵌入 API components | `apps/server/src/http/openapi.ts`、`documentations/lib/source.ts`、`documentations/content/docs/developers/api/**` |
| graph search / concept map page | 需要基于 `source.getPages()` 与 link references 生成 graph JSON | `documentations/lib/build-graph.ts`、`documentations/app/docs/[[...slug]]/page.tsx` 或 `documentations/content/docs/map.mdx` |

## 推荐最高影响页面升级

### 1. `documentations/content/docs/index.mdx`

目标：从目录入口升级为 Cradle knowledge map。

可立即做：

- 增加 `Cards` 分组：`Start`、`Daily workspace`、`Admin`、`Developer`、`Operations`。
- 增加短 table：`User goal` 到 `First page` 的映射。
- 用 `Callout` 标明 local-first、owner/namespace 原则。

Graph-like 增强：

- 嵌入 `GraphView` 或链接到 `/docs/map`。
- 若先不接 Graph View，可用 Mermaid 画顶层关系：Desktop app、Server、Web workspace、Agents、Chronicle、Plugins、Slack bridge。

### 2. `documentations/content/docs/developers/overview.mdx`

目标：让开发者 60 秒内知道 Cradle 的 owner/namespace 体系。

可立即做：

- `Cards`：Server、CLI、Plugin SDK、Database、Runtime、Desktop。
- `TypeTable`：统一展示 `Owner`、`Namespace`、`Lifecycle`、`Interfaces`、`Validation`。
- `Files`：展示 monorepo owner map。

Graph-like 增强：

- Mermaid：`apps/server` 到 `packages/cli`、`apps/web`、`plugins`、`packages/db` 的契约流。

### 3. `documentations/content/docs/developers/api/openapi.mdx`

目标：把 OpenAPI 从说明页升级为可执行 contract reference。

可立即做：

- `Tabs`：`Server route`、`OpenAPI document`、`Generated CLI`。
- `TypeTable`：`x-cradle-cli` metadata 字段。
- `Steps`：新增 route 到 CLI 的生命周期。

需要依赖/config：

- 接入 `fumadocs-openapi` 或等价 generator，基于 `apps/server/src/http/openapi.ts` 暴露的 document 生成 API pages。

### 4. `documentations/content/docs/developers/plugins/sdk-overview.mdx`

目标：让插件作者不用读源码也能理解 capability surface。

可立即做：

- `Tabs`：`Web plugin`、`Desktop plugin`、`Server plugin`。
- `TypeTable`：plugin manifest、capability names、lifecycle callbacks。
- `Files`：plugin package layout。
- `Callout`：Cradle 可读外部 namespace，但不得写入外部 namespace。

相关页面也应同步升级：

- `documentations/content/docs/developers/plugins/web-api.mdx`
- `documentations/content/docs/developers/plugins/desktop-api.mdx`
- `documentations/content/docs/developers/plugins/server-api.mdx`
- `documentations/content/docs/developers/plugins/browser-use.mdx`
- `documentations/content/docs/developers/plugins/system-info.mdx`

### 5. `documentations/content/docs/agents/overview.mdx`

目标：解释 runtime/provider/model/skill/agent identity 的关系，而不是只列对象。

可立即做：

- `TypeTable`：核心对象字段和 owner。
- `Tabs`：`Chat`、`Issue agent`、`Automation` 中 agent 的不同使用路径。

Graph-like 增强：

- Mermaid：Provider -> Model -> Runtime kind -> Agent identity -> Session/Issue/Automation。

### 6. `documentations/content/docs/chronicle/overview.mdx` 和 `setup.mdx`

目标：Chronicle 是跨运行时能力，必须画清楚数据流。

可立即做：

- `Steps`：setup 和 troubleshooting runbook。
- `Files`：local directories / process map，如果源码证据足够。

Graph-like 增强：

- Mermaid：recording -> processing -> memory -> retrieval -> agent context。

### 7. `documentations/content/docs/integrations/slack-bridge.mdx`

目标：把 human-in-the-loop 的事件流讲清楚。

可立即做：

- `Steps`：setup、approval、failure recovery。
- `Tabs`：`Operator` / `Developer`。

Graph-like 增强：

- Mermaid：Slack event -> bridge -> Cradle server -> session await -> user decision -> agent resume。

### 8. `documentations/content/docs/troubleshooting/index.mdx`

目标：从入口页升级为 diagnostic router。

可立即做：

- `Cards` 按 symptom 分类。
- table：`Symptom` / `Likely owner` / `First page` / `Command`。
- `Callout`：哪些操作是 destructive。

### 9. `documentations/content/docs/workspace/files.mdx` 和 `git.mdx`

目标：解释 workspace、filesystem、Git、agent tool boundary。

可立即做：

- `Files`：workspace directory example。
- `Steps`：pack/search/change/review flow。
- `Tabs`：`Read-only exploration` / `Write change` / `Review diff`。

## 建议新增或调整的页面

| Page | 目的 | 依赖 |
| --- | --- | --- |
| `documentations/content/docs/map.mdx` | 全站 concept graph / path finder | 最好依赖 `GraphView`；也可先用 Cards + Mermaid |
| `documentations/content/docs/developers/architecture.mdx` | developer 架构图集合，不把图塞满 overview | Mermaid |
| `documentations/content/docs/developers/api/routes.mdx` | OpenAPI route reference landing page | `fumadocs-openapi` 或 generated MDX |
| `documentations/content/docs/developers/plugins/manifest.mdx` | plugin manifest `TypeTable` reference | 仅需 `TypeTable` |
| `documentations/content/docs/operations/data-flow.mdx` | local server、desktop、web、plugins、Chronicle 的运行关系 | Mermaid |

对应 `meta.json` 可能触点：

- `documentations/content/docs/meta.json`
- `documentations/content/docs/developers/meta.json`
- `documentations/content/docs/developers/api/meta.json`
- `documentations/content/docs/developers/plugins/meta.json`
- `documentations/content/docs/operations/meta.json`

## Graph View 落地建议

### 最小方案

只新增一页 `/docs/map`，用 `GraphView graph={buildGraph()}` 渲染全站页面链接。

可能触点：

- `documentations/source.config.ts`
- `documentations/components/graph-view.tsx`
- `documentations/lib/build-graph.ts`
- `documentations/content/docs/map.mdx` 或 `documentations/app/docs-map/page.tsx`
- `documentations/content/docs/meta.json`

优点：

- 独立页面，不影响每篇文档的阅读节奏。
- 用户能从 map 看到 Cradle 能力之间的链接密度。

缺点：

- 如果当前文档页相互链接不足，graph 会稀疏；需要先补相对链接。
- Graph data 依赖 link extraction，MDX postprocess 变更可能影响 generated output。

### 更高影响方案

在 docs 首页加入小型 `GraphView` preview，并提供 `Open full map`。

可能触点：

- `documentations/app/docs/[[...slug]]/page.tsx`
- `documentations/content/docs/index.mdx`
- `documentations/content/docs/map.mdx`

风险：

- 首屏可能变重。
- Graph UI 可能挤压 Linear-style 的短句入口。

推荐：先做独立 `/docs/map`，通过首页 `Card` 链接过去；确认可读后再考虑首页 preview。

## Mermaid 落地建议

建议优先引入 `beautiful-mermaid`，因为它可以 server render SVG，减少 client hydration 和 theme race；如果需要官方 Mermaid 的交互和主题行为，再选择 `mermaid next-themes`。

推荐首批图：

- `documentations/content/docs/index.mdx`：Cradle top-level capability graph。
- `documentations/content/docs/developers/overview.mdx`：owner/namespace architecture。
- `documentations/content/docs/agents/overview.mdx`：agent runtime relation。
- `documentations/content/docs/chronicle/overview.mdx`：memory data flow。
- `documentations/content/docs/integrations/slack-bridge.mdx`：approval / session await flow。
- `documentations/content/docs/developers/api/openapi.mdx`：route -> OpenAPI -> CLI generation flow。

注意：

- 图中文字应短，正文再解释。
- Mermaid labels 可使用 English，符合代码块/标识符 English 规则，也避免 CJK 渲染差异。
- 如果启用 fenced `mermaid`，要验证 `pnpm build`，因为此前 Shiki 对未知 language 失败过。

## OpenAPI / Type Table 落地建议

短期不要直接承诺完整 API reference 已存在。当前 `documentations/content/docs/developers/api/openapi.mdx` 是契约说明页，而不是 route reference。

建议分三步：

1. 先用 `TypeTable` 文档化 `x-cradle-cli` metadata、route owner checklist、error response contract。
2. 增加 `Tabs` 比较 `HTTP route` 与 `CLI command` 的边界。
3. 再评估 `fumadocs-openapi`，把 `apps/server/src/http/openapi.ts` 暴露的 schema 转成 Fumadocs pages。

可能触点：

- `documentations/package.json`
- `documentations/lib/source.ts`
- `documentations/content/docs/developers/api/openapi.mdx`
- `documentations/content/docs/developers/api/routes.mdx`
- `documentations/content/docs/developers/api/meta.json`
- `apps/server/src/http/openapi.ts`，仅当发现 OpenAPI document 本身缺 metadata 时才应动 server。

## 风险

- Graph View 的价值依赖现有页面互链质量；若只装组件不补链接，graph 会像目录树，不像知识图。
- `extractLinkReferences` 是 MDX postprocess 行为变更，应检查 `.source` generated files 和 build output。
- `Tabs`、`Steps`、`Files`、`TypeTable` 虽在 `fumadocs-ui` 包里，但当前未注册到 MDX；直接在 MDX 使用会失败。
- Mermaid renderer 会引入 SVG rendering 和 theme 行为；client renderer 可能有 hydration 或 first paint 空白，server renderer可能少一些交互能力。
- OpenAPI generated docs 可能放大 server schema 质量问题；如果 route metadata 不稳定，文档会把不稳定契约公开化。
- 仓库规则要求 Markdown 正文中文、代码块和标识符 English；Mermaid label、TypeTable field name、frontmatter value 要继续按 English 处理。
- `metadataBase` 仍未设置权威 docs origin；不要为了消 warning 写 GitHub repo URL。
- 当前 `documentations/` 是未跟踪目录，且工作树有大量并行改动；后续实现时只应触碰 docs polish 相关文件。

## 验证命令

基础验证：

```bash
cd documentations
pnpm types:check
pnpm build
```

组件使用扫描：

```bash
rg -n '<Tabs|<Tab|<Steps|<Step|<Files|<Folder|<File|<TypeTable|<Mermaid|<GraphView' documentations/content/docs documentations/components documentations/app
```

动态 Tailwind 扫描：

```bash
rg -n 'text-\\$\\{|bg-\\$\\{|className=\\{`|className={`' documentations
```

frontmatter 非 ASCII 检查：

```bash
awk '
  BEGIN { in_fm = 0 }
  /^---$/ { in_fm = !in_fm; next }
  in_fm && /^(title|description):/ && /[^ -~]/ { print FILENAME ":" FNR ":" $0 }
' $(find documentations/content/docs -name '*.mdx' | sort)
```

本地 smoke check：

```bash
cd documentations
pnpm dev
```

手动检查 URL：

- `http://localhost:3000/docs`
- `http://localhost:3000/docs/map`，如果新增 Graph View 页面
- `http://localhost:3000/docs/developers/overview`
- `http://localhost:3000/docs/developers/api/openapi`
- `http://localhost:3000/llms.txt`
- `http://localhost:3000/llms-full.txt`

如果启用 Graph View：

```bash
rg -n 'extractLinkReferences|GraphView|buildGraph|linkReferences' documentations
cd documentations
pnpm types:check
pnpm build
```

如果启用 Mermaid：

```bash
rg -n 'Mermaid|remarkMdxMermaid|```mermaid|beautiful-mermaid|mermaid' documentations
cd documentations
pnpm types:check
pnpm build
```

如果启用 OpenAPI generated docs：

```bash
cd apps/server
pnpm test -- openapi
pnpm typecheck

cd ../../documentations
pnpm types:check
pnpm build
```

## 建议实施顺序

1. 注册 `Tabs`、`Steps`、`Files`、`TypeTable`，只改 `documentations/components/mdx.tsx`。
2. 改造 `index.mdx`、`developers/overview.mdx`、`developers/api/openapi.mdx`、`developers/plugins/sdk-overview.mdx`、`agents/overview.mdx`。
3. 补 `/docs/map` 入口，但先用 Cards + cross-links；同时增加页面之间的相对链接。
4. 接 Fumadocs `Graph View`，启用 `extractLinkReferences`，生成 `buildGraph()`。
5. 接 Mermaid，先画 4-6 张核心架构/流程图。
6. 最后评估 `fumadocs-openapi`，不要把 OpenAPI route reference 放在第一批 polish 阻塞项里。

这个顺序能先提升阅读速度，再补图谱能力，最后处理 API reference 自动化，风险从低到高递增。
