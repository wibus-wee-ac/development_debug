# ReviewM: Fumadocs link graph blocker handoff

## 结论

ReviewL 的 blocker 成立。当前 `/docs/map` 只是手写 path map，不是真正消费 Fumadocs link references 的 graph-like capability。

本地安装包可用的能力不是一个现成可导入的 `GraphView` 组件，而是：

- `fumadocs-mdx` 的 `postprocess.extractLinkReferences` 会从 Markdown link node 提取 `href`，并导出到每页 `extractedReferences`。
- `.source/server.ts` 已把 `extractedReferences` 加入 passthrough 类型，说明当前配置已经让该字段进入 collection data。
- `fumadocs-core/source` 的 loader 提供 `source.getPages()`、`source.getPageByHref()` 和 `source.resolveHref()`，足够在本地构建 page-to-page link graph。

因此 PASS 不应要求“必须存在官方 Graph View”，而应要求 `/docs/map` 的数据源真实来自 `source.getPages()` 和每页 `page.data.extractedReferences`。如果后续团队引入官方/CLI 生成的 Graph View 组件，可以作为渲染层；但 blocker 的核心是数据必须来自 Fumadocs 抽取结果，而不是静态数组。

## 已检查文件

- `documentations/source.config.ts`
- `documentations/lib/source.ts`
- `documentations/components/docs-visuals.tsx`
- `documentations/content/docs/map.mdx`
- `documentations/.source/server.ts`
- `documentations/.source/browser.ts`
- `documentations/.source/dynamic.ts`
- `node_modules/.pnpm/fumadocs-mdx@15.0.7_*/node_modules/fumadocs-mdx/dist/*`
- `node_modules/.pnpm/fumadocs-core@16.8.12_*/node_modules/fumadocs-core/dist/source/index.d.ts`

## 本地 Fumadocs 能力证据

`documentations/source.config.ts` 当前已开启：

```ts
postprocess: {
  includeProcessedMarkdown: true,
  extractLinkReferences: true,
}
```

生成的 `documentations/.source/server.ts` 包含：

```ts
DocData: {
  docs: {
    extractedReferences: import("fumadocs-mdx").ExtractedReference[];
  },
}
```

并且 runtime create options 包含：

```ts
{"doc":{"passthroughs":["extractedReferences"]}}
```

`fumadocs-mdx` 本地类型定义显示：

```ts
interface ExtractedReference {
  href: string;
}
```

`fumadocs-mdx` 本地实现只访问 Markdown AST 的 `link` node：

```ts
visit(tree, "link", (node) => {
  urls.push({ href: node.url });
  return "skip";
});
```

`fumadocs-core` loader 本地类型显示可解析链接：

```ts
getPages: (language?: string) => Config["page"][];
getPageByHref: (href: string, options?: { language?: string; dir?: string }) => {
  page: Config["page"];
  hash?: string;
} | undefined;
resolveHref: (href: string, parent: Config["page"]) => string;
```

这些 API 足以构建内部文档边：

```ts
const pages = source.getPages();
const edges = pages.flatMap((page) =>
  page.data.extractedReferences
    .map((reference) =>
      source.getPageByHref(reference.href, {
        dir: page.path.split("/").slice(0, -1).join("/"),
      }),
    )
    .filter(Boolean),
);
```

上面只是形状说明；最终实现应处理 hash、外链、重复边、自环、缺失目标和相对路径。

## 当前实现问题

`documentations/components/docs-visuals.tsx` 的 `docsGraphClusters` 是静态数组。`DocsKnowledgeGraph` 只遍历该数组渲染分组链接，没有 import `source`，没有读取 `source.getPages()`，也没有读取 `page.data.extractedReferences`。

`documentations/content/docs/map.mdx` 只调用：

```mdx
<DocsKnowledgeGraph />
```

所以 `/docs/map` 当前无法证明：

- 哪些页面真实互相链接；
- 哪些链接能被 Fumadocs resolve；
- 哪些页面没有 inbound 或 outbound links；
- 哪些相对链接、hash link、外链或坏链被排除；
- 当前 graph 是否随 MDX 内容变化自动更新。

## PASS 验收标准

### 1. 数据源必须来自 Fumadocs link references

代码中必须存在一个 graph/link builder，位置建议为 `documentations/lib/docs-link-graph.ts` 或等价 server-only module。

它必须：

- 调用 `source.getPages()`。
- 读取每页 `page.data.extractedReferences`。
- 用 `source.getPageByHref()` 或 `source.resolveHref()` 把 `href` 转为内部页面 URL。
- 输出 nodes 和 edges，其中 node URL/title 来自 Fumadocs page data。
- 对外链、hash-only links、无法解析的 links 和重复边有明确处理。

验收扫描应能看到：

```bash
rg -n "extractedReferences|getPageByHref|resolveHref|getPages" documentations/lib documentations/components documentations/app
```

### 2. `/docs/map` 必须渲染 graph-derived output

`/docs/map` 页面输出至少要展示一个由 builder 结果驱动的 graph-like view。可接受形式：

- 节点和边的可视化图；
- 按 source page 分组的 outbound/inbound relationship table；
- orphan pages、unresolved links、external links 的 summary；
- graph stats，例如 page count、internal edge count、external reference count。

不可接受形式：

- 只保留静态 `docsGraphClusters`。
- 只写“Graph”字样或图标。
- 只依赖手工维护的 page list。

如果保留 curated clusters，它们只能作为辅助导航；页面上必须有一块明确来自 Fumadocs references 的内容。

### 3. 可见文案必须改为简体中文

`docs-visuals.tsx` 和 `map.mdx` 中面向读者的标题、说明、按钮、关系 label 应使用简体中文。`OpenAPI`、`CLI`、`runtime`、`plugin`、路径、接口名等技术标识可以保留英文。

ReviewL 点名的这些内容不能继续以英文可见正文出现：

- `Cradle docs graph`
- `Start from a reader goal...`
- `Open full map`
- `How to read the map`
- `First decision`
- `System boundary`
- `Next steps`

### 4. 构建和类型检查必须通过

修复后运行：

```bash
cd documentations
pnpm types:check
pnpm build
```

### 5. smoke evidence 应覆盖桌面和移动

至少检查：

- `/docs`
- `/docs/map`
- `/docs/developers/overview`
- `/docs/agents/overview`
- `/docs/chronicle/overview`
- `/docs/integrations/slack-bridge`
- `/docs/troubleshooting`

重点看 graph 区域是否非空、中文文案是否一致、卡片/表格在移动宽度是否拥挤或重叠。

## 建议实现路径

最小可过路径：

1. 新增 server-side graph builder，从 `source.getPages()` 和 `extractedReferences` 产出 `nodes`、`edges`、`unresolvedReferences`、`externalReferences`、`orphanPages`。
2. 把 `DocsKnowledgeGraph` 改为接收 graph data，或新增一个 server component wrapper 在 `/docs/map` 使用。
3. `/docs/map` 展示 graph stats、internal links、orphan pages 和 unresolved links；后续再补更复杂的可视化。
4. 把所有 visual copy 改成简体中文。

如果后续想接真正的 Graph View UI，需要先确认本地是否新增了对应 component 文件或依赖。当前 `fumadocs-ui@16.8.12`、`fumadocs-core@16.8.12`、`fumadocs-mdx@15.0.7` 的本地包内没有可直接满足此任务的 `GraphView` export。
