# Search as Code Generation Handoff

## 用途

这份文档用于未来重新启动一个会话时快速恢复上下文。新的 agent 不需要读取当前聊天历史，只需要读取：

- `docs/specs/search-as-code-generation.md`
- `docs/specs/search-as-code-generation-handoff.md`
- 当前工作树中的相关模块 README 和代码

## 当前目标

基于 Perplexity Research 的 “Rethinking Search as Code Generation”，为 Cradle 设计并实现一个脱离历史债务的 agentic search runtime。

最终目标不是传统 web search，也不是 MCP search wrapper，而是：

- 模型生成 Python 搜索程序。
- 隔离 substrate 执行程序；默认必须是 WASM/Pyodide-style 或等价沙箱，raw native CPython 只能作为 unsafe dev fallback。
- Search SDK 暴露原子 primitive。
- 中间状态通过 explicit filesystem serde 持久化。
- 最终只把 compact evidence 和 citation ledger 返回给 Chat Runtime。
- Host bridge 持有 provider credential、policy、budget 和 audit，不把这些能力交给 Python code。
- Retrieved web/local/provider text 一律是 untrusted evidence，不能升级成 system/developer/runtime instructions。

## 已完成产物

- 主 SPEC：`docs/specs/search-as-code-generation.md`
- 本 handoff：`docs/specs/search-as-code-generation-handoff.md`

## 关键外部依据

Perplexity Research 原文：

```text
https://research.perplexity.ai/articles/rethinking-search-as-code-generation
Published: 2026-06-01
```

关键摘论：

- Search must move from monolithic service to programmable primitives.
- Models are the control plane.
- Secure sandboxes provide deterministic compute.
- Agentic Search SDK exposes atomic search stack components.
- Generated Python code orchestrates retrieval operations.
- Persistent filesystem plus explicit serde is preferred over REPL state for long trajectories.
- Skills teach usage patterns and should avoid context bloat.
- Benchmarks should measure accuracy, cost, latency, and wide research capability.

Perplexity API 侧：

- Search API 可作为 ranked web results provider。
- Agent/Sonar generation endpoint 不应作为底层 primitive 的唯一实现。
- Search API 返回 `results[]`，`max_results` 为 1 到 20。
- Domain filter 最多 20 个，allowlist/denylist 不能混用。

## 当前 Cradle 证据入口

请优先读取这些文件：

```text
apps/server/src/modules/search/README.md
apps/server/src/modules/chat-runtime/README.md
apps/server/src/modules/provider-runtime/README.md
apps/server/src/modules/skills/README.md
apps/server/src/modules/chat-runtime/runtime-provider-types.ts
apps/server/src/modules/chat-runtime/model.ts
docs/specs/README.md
```

当前判断：

- `SearchModule` 已拥有 thread/Chronicle search，不应吞掉 SaC runtime。
- `ChatRuntime` 已拥有 run lifecycle 和 provider UI slots，是 SaC 的 consumer。
- `ProviderRuntime` 负责 provider-native handle，不拥有 SaC 语义。
- `SkillsModule` 有明确 namespace ownership，Cradle 写 skill 必须走 Cradle-owned namespace。
- 第一版 SPEC 已被修订：不能把普通本机 Python 进程当作 production sandbox；必须证明禁网、禁 env、禁 host FS、禁 subprocess。

## 推荐恢复 Prompt

```text
Continue the Cradle Search as Code Generation work.

Read:
- docs/specs/search-as-code-generation.md
- docs/specs/search-as-code-generation-handoff.md
- apps/server/src/modules/search/README.md
- apps/server/src/modules/chat-runtime/README.md
- apps/server/src/modules/provider-runtime/README.md
- apps/server/src/modules/skills/README.md

Task:
Implement or refine the Agentic Search Runtime according to the SPEC. Treat current worktree and code as authoritative. Do not rely on chat history. Preserve namespace ownership. Prefer a clean architecture over compatibility glue.

Expected first action:
Inspect current git status and determine whether implementation has already started. If not, create an implementation plan from the SPEC. If it has started, audit it against the SPEC requirement by requirement, then continue the missing work.

Hard constraints:
- Use TypeScript and existing Cradle server module patterns.
- Use Drizzle for database schema and migrations.
- Do not write to foreign namespaces.
- Keep tools primitive and usage guidance in skills.
- Do not turn SaC into a monolithic research endpoint.
- Use fake provider tests before real external API tests.
- Do not implement production SaC by spawning raw native CPython. Use a verifiably isolated sandbox substrate. Native CPython is unsafe dev mode only.
- Enforce Perplexity Search API provider limits in host code: results[] shape, max_results <= 20, max 20 domain filters, no mixed allow/deny mode.
- Add SSRF and URL policy tests before treating web fetch as complete.
- Add retrieved-content prompt-injection tests before treating evidence handling as complete.

Completion audit:
Before declaring complete, verify every route, schema, database table, sandbox invariant, SDK primitive, skill file, Chat Runtime integration, and test listed in the SPEC.
```

## 后续实现顺序

1. 新建 `apps/server/src/modules/agentic-search-runtime/`。
2. 选择并验证 default sandbox substrate；优先 WASM/Pyodide-style runtime。
3. 做 fake provider + sandbox artifact lifecycle。
4. 增加 Drizzle schema/migration。
5. 跑通 Python SDK host bridge。
6. 加 HTTP routes 和 CLI metadata。
7. 接入 Chat Runtime 的 runtime capability/UI slot。
8. 新增 Cradle-owned skill。
9. 接入 Perplexity Search API provider。
10. 增加 eval harness。
11. 审核所有文档和验收标准。

## 风险提醒

- 不要把 SaC 放进 `apps/server/src/modules/search/`，否则 owner 边界会混乱。
- 不要把 Search API 结果直接塞回模型上下文，这会回到传统 monolithic search。
- 不要依赖 REPL state 跨轮恢复；SPEC 要求 explicit serde。
- 不要让 Python sandbox 直接拿 API key 或直接访问网络。
- 不要让 URL fetch 只做字符串域名检查；必须校验 redirect 后地址和 private/local/link-local IP。
- 不要把网页、PDF、thread memory 或 workspace 文件里的文本拼进 system/developer prompt；它们只能作为 untrusted evidence。
- 不要为了 UI 漂亮先做大量前端；先保证 runtime 和 artifact contract。
