<!--
Output: Linear developer documentation research handoff for Cradle documentation planning.
Input: Linear developer documentation and Cradle documentation ExecPlan.
Position: Evidence artifact for docs/exec-plans/20260521-05-linear-style-documentation.md.
-->

# Linear developer docs research handoff

本文件是 ExplorationB 的独立交接材料，只用于规划 Cradle developer docs。它总结 Linear developer documentation 的信息架构、页面组织、口吻、参考页模式，以及迁移到 Cradle 文档站时应采用的具体规则。本文不复制 Linear 文案，只抽取结构和写法。

## Sources studied

- https://linear.app/developers
- https://linear.app/developers/graphql
- https://linear.app/developers/pagination
- https://linear.app/developers/filtering
- https://linear.app/developers/rate-limiting
- https://linear.app/developers/webhooks
- https://linear.app/developers/oauth-2-0-authentication
- https://linear.app/developers/sdk
- https://linear.app/developers/sdk-fetching-and-modifying-data
- https://linear.app/developers/how-to-upload-a-file-to-linear
- https://linear.app/developers/aig
- https://linear.app/developers/agents
- https://linear.app/developers/agent-interaction
- https://linear.app/developers/agent-best-practices
- https://linear.app/developers/agent-signals
- https://linear.app/docs

## Observed IA

Linear developer docs 是独立于用户 docs 的入口，不把所有产品说明混在一起。顶层导航保留 Docs、Developers、Learn、Contact support，说明 developer docs 是产品文档旁边的并列入口，而不是产品文档的一个深层章节。

Developer landing page 的主体很短，只做路由分发：

- Getting Started：GraphQL API、Authentication、Agents、TypeScript SDK。
- Guides：Upload a file、Create issues via URL、CLI importer。
- Resources：Changelog、Brand Guidelines、Agent Interaction Guidelines。

左侧导航按开发者要集成的能力分组，而不是按内部代码模块分组：

- GraphQL API：getting started、pagination、filtering、rate limiting、deprecations、webhooks、attachments、managing customers、external schema reference。
- Authentication：OAuth 2.0、actor authorization、file storage authentication。
- Agents：guidelines、getting started、interaction development、best practices、signals。
- TypeScript SDK：getting started、fetching and modifying data、errors、advanced usage、webhooks、migration、GitHub。
- Guides：面向特定任务的做法。

用户 docs 的 IA 则按产品概念和用户任务分组，例如 getting started、account、AI、sidebar、teams、issues、projects、cycles、views、integrations、administration。差异很清楚：用户 docs 解释“如何使用 Linear”，developer docs 解释“如何把系统接到 Linear 上，并遵守平台契约”。

## Page Anatomy

Developer landing page：

- 一个明确的 H1。
- 一句定位说明。
- 三个短分组，每个分组由卡片链接组成。
- 卡片标题是能力名，描述是读者能完成的动作。
- 不在首页塞大量说明，避免把入口页写成概念论文。

Reference or guide page：

- 左侧是全站 developer sidebar。
- 页面顶部有 breadcrumb。
- 页面有 Copy page as markdown 入口。
- 右侧或页面末尾有本页 anchors。
- H1 后先给 1-2 段说明，立即交代适用场景和能力边界。
- 之后按任务流排列：概念、前置条件、请求、参数、响应、错误、下一步。
- 代码块都有 copy button。
- 长页用 H2/H3/H4 分层，避免每节承担多个主题。
- 页面底部有 Previous / Next，形成线性学习路径。

Agents 页面有更强的体验契约结构：先说明 preview 状态，再说明 setup、authentication、session lifecycle、webhook entrypoint。Agent Interaction 页面把 API 参考和 UX 行为绑定：session state、external URLs、webhooks、activity types、repository suggestions、completion/error behavior 都放在同一个行为模型下。

## Tone Guide

Linear developer docs 的口吻是直接、具体、低情绪密度的工程文档：

- 先说读者能做什么，再说背景。
- 用短句，不堆营销形容词。
- 对限制、权限、超时、重试、preview 状态直说。
- 对安全要求采用明确的 SHOULD / MUST 语气，例如 OAuth state、webhook signature、admin scope、token refresh。
- 对复杂系统先给最小可运行路径，再逐步展开高级用法。
- 术语稳定，同一概念不频繁换名字。
- 使用真实对象和真实操作名，不用抽象占位词掩盖行为。
- 不把错误处理藏在 FAQ，直接放在接口页的主流程里。

Cradle 应采用中文正文，但保持这种节奏：短段落、任务导向、明确边界、少形容词。路径、命令、接口、schema、package、frontmatter、code block 全部保留 English。

## Reference Patterns

### API reference pattern

GraphQL getting started 页先给 endpoint，再给 authentication，再给错误处理、SDK 路径、queries/mutations 示例、fetching updates、support。Pagination 页独立说明 cursor model、默认返回数量、next cursor、orderBy。Rate limiting 页独立说明避免触发限制的策略、响应头、复杂度、错误形状。

可迁移规则：

- Cradle server API docs 应先列 base URL、authentication、content type、error envelope、pagination/filtering/sorting、rate limit 或 concurrency limit。
- 每个接口族都要有最小请求、最小响应、错误响应、权限边界、幂等性说明。
- 不要只生成 OpenAPI 表格；需要补充“何时用这个 endpoint”和“它归哪个 namespace owner 管”。

### Authentication pattern

OAuth 页面按完整生命周期写：创建应用、redirect、参数表、PKCE、callback、token exchange、refresh、API request、revoke、client credentials。它把安全边界放进主流程，而不是另开安全附录。

可迁移规则：

- Cradle plugin SDK 和 server API 认证页应按 lifecycle 写：register、request permission、exchange token 或 create key、refresh/revoke、use token、rotate secret。
- 对 desktop integration 必须区分 local trusted channel、browser callback、remote server token，不要把桌面本地权限和云端 API 权限混在一起。

### Webhook pattern

Webhooks 页先说明模型、权限和可订阅资源，再说明 consumer endpoint 条件、timeout、retry、signature verification、settings setup、API setup、query/delete、payload schema。它同时覆盖 UI 配置和 API 配置。

可迁移规则：

- Cradle automation docs 应把 event source、delivery contract、retry policy、signature or trust model、dedupe key、idempotency key、dead-letter behavior 放在同一页。
- 对 automation 和 plugins，必须明确哪些事件由 server 发送，哪些由 desktop app 发送，哪些只是 local runtime signal。

### SDK pattern

SDK docs 用最小安装和初始化进入，然后按 query、mutation、pagination、errors、advanced usage、migration 分页。Fetching/modifying data 页用短代码片段展示对象访问、connection、optional variables、model operation、payload success。

可迁移规则：

- Cradle plugin SDK docs 应先给最小 plugin、manifest、capabilities、runtime context，再分 ability pages：commands、views、storage、events、permissions、testing、publishing。
- Generated CLI docs 应借用 SDK 风格：先给 install / build / auth / first command，然后按 command group 说明 input、output、json mode、exit codes、pagination、scripting examples。

### Agent pattern

Agents docs 把 agent 当作平台参与者，而不是后台脚本。关键点包括 app actor、mention/assign scopes、session lifecycle、visible states、webhooks、activities、clarification、tool/action reporting、errors、human accountability。

可迁移规则：

- Cradle agent runtime docs 应以 session lifecycle 为主线：created、planning、tool execution、awaiting input、completed、failed、cancelled。
- Automation docs 应明确 agent visible state、handoff state、approval gate、user disengage behavior。
- Chronicle、observability、devtools 应作为“inspect the underlying reasoning, tool calls, prompts, and decision logic”的证据入口，而不是单独的内部工具说明。

## Reusable Page Templates

### Developer landing page

- Title：能力域名称。
- One sentence：这一组 docs 帮读者完成什么集成。
- Getting started cards：最短路径。
- Reference cards：稳定契约。
- Guides cards：具体任务。
- Resources cards：changelog、examples、migration、support。

适用于 Cradle Developer 首页。

### Capability overview page

- Title。
- What this capability is for。
- When to use it。
- Ownership and namespace。
- Minimal setup。
- Core lifecycle。
- Common tasks。
- Limits and failure modes。
- Next pages。

适用于 plugin SDK、automation、desktop integration、database ownership。

### API reference page

- Title。
- Endpoint or command。
- Authentication and permissions。
- Request shape。
- Response shape。
- Error shape。
- Pagination or streaming behavior。
- Rate, concurrency, or resource limits。
- Idempotency and retries。
- Examples。
- Related pages。

适用于 server API、generated CLI、automation webhooks。

### Guide page

- Goal。
- Prerequisites。
- Steps。
- Verify。
- Troubleshooting。
- Cleanup or rollback。
- Next step。

适用于 upload/import/export、plugin creation、desktop callback setup、automation recipe。

### Agent interaction page

- Interaction model。
- Trigger conditions。
- Session states。
- Activity types。
- Required acknowledgements。
- User-visible state。
- Approval and disengage behavior。
- Observability and audit trail。
- Error recovery。

适用于 Cradle agent runtime、session await、issue agents、automation agents。

## Concrete Rules for Cradle Developer Docs

### Server API

- Developer sidebar 中建立 `Server API` 分组，而不是埋在 product docs。
- 首页卡片指向 overview、authentication、OpenAPI/reference、webhooks/events、errors、rate limits。
- 每个 route family 必须说明 owner namespace、read/write boundary、permission model、request/response、error envelope、versioning。
- 如果 API 由 OpenAPI 生成 CLI，API 页要链接到对应 CLI command，CLI 页要反链 API endpoint。

### Generated CLI

- 建立独立 `Generated CLI` 分组：getting started、authentication/config、command output、json mode、exit codes、scripting、migration。
- 每个 command group 采用 task guide + reference 双层结构：先教真实任务，再列 flags/schema。
- 明确 stdout/stderr、exit code、machine-readable output 的稳定性。
- 解释 CLI generator 从 OpenAPI metadata 读取哪些字段，哪些字段由 server module owner 维护。

### Plugin SDK

- 建立 `Plugin SDK` 分组：getting started、manifest、capabilities、runtime context、commands、views、storage、events、permissions、testing、publishing。
- 所有 plugin docs 必须从 ownership 开始：plugin owns its namespace；Cradle may read external namespace but must write only to Cradle-owned namespace unless the external owner explicitly defines an API。
- 对每个 capability 写清 lifecycle：registration、activation、execution、cleanup、upgrade。
- 示例应短，并用一个可运行插件贯穿多页，避免每页换一个概念样例。

### Plugins

- `Plugins` 应区别于 `Plugin SDK`：前者面向安装、配置和运行现有插件；后者面向开发插件。
- 每个 first-party plugin 页包含 purpose、installation、configuration、permissions、data ownership、events emitted、troubleshooting。
- Browser-use、system-info、Slack bridge 等插件要标明它们读取/写入哪些 namespace，以及哪些 secret 或 local resource 会被使用。

### Database Ownership

- 单独建立 `Database Ownership` 或放入 `Architecture` 分组，不要只在开发者内部规范里出现。
- 页面主线不是 schema 表，而是 ownership rule：who owns tables, migrations, compatibility, writes, read-only integration。
- 每个数据域文档应列 owner、tables、Drizzle schema location、migration owner、allowed readers、forbidden writes、compatibility policy。
- 任何跨 namespace 写入必须在 docs 中被标为 risk 或 forbidden pattern。

### Automation

- 建立 `Automation` 分组：events、triggers、actions、webhooks/local signals、retries、idempotency、approvals、observability。
- 借用 Linear webhook pattern：先说明 consumer/producer contract，再给 setup，再给 payload/reference。
- 对 issue agents、kanban agents、session await 说明 lifecycle 和 visible state，不要只写 API。
- 每个 automation recipe 必须包含 failure behavior 和 how to inspect。

### Desktop Integration

- 建立 `Desktop Integration` 分组：overview、local bridge、workspace filesystem access、deep links、auth callbacks、notifications、updates、troubleshooting。
- 明确本地桌面通道和 server API 的权限边界。
- 对 Electron/desktop 能力给出 threat model：local file access、shell command execution、secrets, user approval。
- 所有桌面集成页应链接到 plugin permissions、approvals、workspace ownership。

## Adaptation Risks

- Linear 的开发者文档大量围绕公开平台 API；Cradle 目前可能有更多本地桌面、插件、数据库 ownership 和 agent runtime 内部语义。直接照抄 IA 会遗漏这些 Cradle 特有边界。
- Linear 的 GraphQL reference 依赖 Apollo Studio 外部 schema explorer；Cradle 若用 OpenAPI/Fumadocs，需要把自动生成 reference 与手写 guide 明确分层。
- Linear 的 tone 很短，但短不等于省略契约。Cradle 不能为了像 Linear 而删掉 ownership、security、approval、migration 细节。
- Agents docs 中的体验原则适合 Cradle，但 Cradle 需要额外说明 tool permission、workspace mutation、local command execution、desktop app interrupt/cancel 行为。
- 中文文档若机械翻译英文模板，容易变成长句。应保持短句和明确动词。
- Plugin docs 如果同时面向使用者和开发者，入口会混乱。必须拆分 `Plugins` 与 `Plugin SDK`。

## Recommended Cradle Developer IA

- `developers/index.mdx`：Developer docs landing。
- `developers/server-api/`：overview、authentication、errors、pagination、webhooks-or-events、reference。
- `developers/generated-cli/`：getting-started、configuration、commands、json-output、exit-codes、scripting。
- `developers/plugin-sdk/`：getting-started、manifest、capabilities、runtime-context、storage、events、permissions、testing、publishing。
- `developers/plugins/`：overview、browser-use、system-info、slack-bridge、plugin-lifecycle。
- `developers/automation/`：overview、events、triggers-actions、approvals、session-await、observability、recipes。
- `developers/agents/`：runtime-model、session-lifecycle、activities、issue-agents、kanban-agents、human-control。
- `developers/desktop-integration/`：overview、local-bridge、deep-links、workspace-access、auth-callbacks、troubleshooting。
- `developers/database-ownership/`：overview、namespace-rules、schema-map、migration-policy、cross-namespace-integration。
- `developers/resources/`：changelog、examples、migration-guides、support。

## Acceptance Checklist

- [x] Studied Linear developer landing page and sidebar organization.
- [x] Studied GraphQL API overview, pagination, rate limits, and webhook docs.
- [x] Studied OAuth lifecycle and authentication page structure.
- [x] Studied TypeScript SDK organization and fetching/modifying data examples.
- [x] Studied Agents, Agent Interaction Guidelines, session lifecycle, and activity model.
- [x] Compared developer docs against user docs IA.
- [x] Summarized patterns without long verbatim copying.
- [x] Cited URLs used.
- [x] Translated findings into Cradle rules for server API, generated CLI, plugin SDK, plugins, database ownership, automation, and desktop integration.
- [x] Included observed IA, page anatomy, tone guide, reference patterns, reusable page templates, adaptation risks, and this checklist.
