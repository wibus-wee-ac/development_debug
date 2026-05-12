# Apps Server Elysia Replatform

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `docs/exec-plans/README.md` and the ExecPlan `PLANS.md` convention used by this repository.

## Purpose / Big Picture

Cradle 现在的 `apps/server` 已经不只是一个普通 HTTP 服务，它是 `@tsuki-hono/common`、`@tsuki-hono/core`、装饰器 metadata、DI 运行时、自研 `packages/openapi` 推导桥和 Hono carrier 叠出来的一整套执行壳。用户能看到的结果是：服务可以跑，但 `apps/web` 经常拿到失真的 OpenAPI 产物，生成客户端退化成 `arg0`、`body: string` 或 `unknown`，于是前端不得不绕过生成层自己写 `fetch`。这个计划的目标不是把 Tsuki API 翻译成 Elysia API，而是把 `apps/server` 重新建立成一个显式、透明、schema-first 的 Elysia 服务端，让 `apps/web` 再次把 HTTP 契约当成可靠边界。

计划完成后，开发者将能做到三件当前做不到或做不稳的事。第一，`apps/server` 的每个 capability 都由 feature-owned 的 Elysia route 实例声明，request/response schema 直接来自运行时 schema，而不是从 class 参数和装饰器 metadata 猜出来。第二，`apps/web` 继续使用 `OpenAPI -> @hey-api/openapi-ts` 作为第一阶段集成边界，但对迁移完成的接口不再出现 `arg0`、`body: string` 这种失真签名。第三，服务端的组合方式将从 `@Module/@Controller/@inject` 的隐式装配改成显式 composition root：route factory 明确接收 service/store 依赖，便于测试、删除和替换。

用户可见的验收方式也很明确：启动新的 `apps/server` 后，`/health`、`/openapi.json`、`/docs`、聊天 SSE 和 PTY SSE 仍然可用；在 `apps/web` 里重新执行 `pnpm generate` 后，生成的 SDK 对已迁移接口拿到稳定的 named params/body；再运行 `apps/web` 界面时，workspace、session、chat-runtime 等核心流程继续工作。

## Progress

- [x] (2026-05-10 06:55Z) 阅读 ExecPlan 规范、现有 `docs/exec-plans/*` 样例和 `docs/exec-plans/README.md`，确认计划必须自包含、可执行、可回放，并且目录清单必须同步更新。
- [x] (2026-05-10 07:00Z) 审核当前 `apps/server` 和 `apps/web` 的集成路径，确认主边界是 `apps/server/src/openapi/openapi-routes.ts` 暴露的 `/openapi.json`，`apps/web/openapi-ts.config.ts` 消费该文档生成 SDK，聊天与 PTY 流式接口仍存在手写 `fetch` 旁路。
- [x] (2026-05-10 07:05Z) 阅读 Elysia 的 Node、OpenAPI、Drizzle、Eden、Best Practice 文档，确认 Node 运行不是 blocker，OpenAPI 与 Standard Schema 足够承接当前服务端 schema-first 重构。
- [x] (2026-05-10 07:10Z) 形成迁移策略：本计划采用破坏性重构，不保留 Tsuki compatibility layer，但允许在实施期间存在短命的并行 skeleton 以降低删除风险；最终交付必须删除 Tsuki runtime 与 `packages/openapi`。
- [x] (2026-05-10 07:18Z) 运行 `cd apps/server && pnpm typecheck` 记录实际编译器基线，确认编辑器里关于 `profiles` / `secrets` 的报错是陈旧诊断，当前 `apps/server` 基线 typecheck 实际为绿色。
- [x] (2026-05-10 07:23Z) 安装 `elysia`、`@elysiajs/node`、`@elysia/openapi`，并确认 Node adapter 的真实 npm 包名是 `@elysiajs/node` 而不是文档里写的 `@elysia/node`。
- [x] (2026-05-10 07:32Z) 建立平行 Elysia skeleton：新增 `apps/server/src/app.ts`、`apps/server/src/http/*`、`apps/server/src/modules/health/health.routes.ts` 和 `apps/server/tests/elysia-skeleton.test.ts`，在不触碰 Tsuki 生产路径的前提下暴露 `/health`、`/openapi.json`、`/docs/openapi.json`、`/docs`。
- [x] (2026-05-10 07:40Z) 完成 Milestone 0 验证：`cd apps/server && pnpm vitest run tests/elysia-skeleton.test.ts && pnpm typecheck` 通过；随后完整执行 `cd apps/server && pnpm test && pnpm build`，49 个现有测试与 2 个新 skeleton 测试全部通过，build 通过。
- [x] (2026-05-10 07:55Z) 将 `health` 从“route 内联逻辑”推进到“显式 feature 依赖”形态：新增 `health.contract.ts`、`health.service.ts`，让 `createServerApp(overrides)` 通过 `createServerDeps()` 注入 `healthService`，并用测试证明显式依赖覆盖生效。
- [x] (2026-05-10 08:05Z) 通过上下文独立的设计分析，确认下一阶段应优先系统化共享 HTTP 语义层（尤其是 validation normalization），然后以 `preferences` 作为第一个真实 JSON feature 切片；暂不碰 SSE、Eden、TypeBox 切换或 Tsuki 旧入口删除。
- [x] (2026-05-10 08:16Z) 根据用户新指令，放弃“迁移路径继续沿用 Zod”策略，已将平行 Elysia skeleton 的 `health` schema 和 OpenAPI 路径切换为 `Elysia.t / TypeBox`，验证 `pnpm vitest run tests/elysia-skeleton.test.ts && pnpm typecheck` 继续通过。
- [x] (2026-05-10 15:40 local) 在 `src/http/validation.ts` 建立 Elysia validation normalization：统一把 `ValidationError` 归一化为结构化 envelope，并在 composition root 里用显式 path+method profile 把 `PUT /preferences/chat` 绑定到 `invalid_preferences_input` 语义。
- [x] (2026-05-10 15:40 local) 将 `preferences` 迁移为第一个真实 Elysia feature slice：新增 `preferences.routes.ts`，在 `src/app.ts` 显式注入 `preferencesService`，并用 `Elysia.t / TypeBox` 暴露 `GET/PUT /preferences/chat`，同时保持文件系统持久化语义与结构化错误语义。
- [x] (2026-05-10 15:40 local) 完成该切片验证：`pnpm vitest run tests/elysia-skeleton.test.ts` 通过，覆盖 `/preferences/chat` 读写、invalid payload 结构化错误以及 OpenAPI 路径暴露。
- [x] (2026-05-10 17:10 local) 将 `workspace` 迁移到平行 Elysia 路径：新增 `workspace.routes.ts` 与 `workspace.types.ts`，在 `src/app.ts` 中显式构造 `DatabaseConfig -> DbProvider -> DbAccessor -> WorkspaceStore -> WorkspaceFiles -> WorkspaceService`，并显式执行 migration 后挂载 `/workspaces` 路由族。
- [x] (2026-05-10 17:10 local) 扩展 shared validation profile resolver，使 composition root 可以用显式 path / regex + method 绑定 `invalid_workspace_input`；workspace 的 body/query 校验现在统一走 `src/http/validation.ts` 的结构化 envelope。
- [x] (2026-05-10 17:10 local) 扩展 `tests/elysia-skeleton.test.ts` 覆盖 workspace OpenAPI、CRUD/resolve、files/content、409 duplicate path，以及 `invalid_workspace_input` 的 body/query 结构化错误语义。
- [x] Milestone 0: 基线收敛与最小 Elysia skeleton。
- [x] Milestone 1: 建立显式 composition root 和跨 feature 共享依赖。
- [x] Milestone 2 (partial): 迁移 `usage` 为下一个 Elysia module（待完成）。
- [x] (2026-05-10 19:00 local) Round 2 — 按 Elysia 最佳实践重写 workspace + preferences：
  - 新建 `src/infra.ts` 集中管理 app-level 基础设施单例（ServerConfig、Logger、DbProvider、db()）
  - `AppError` 脱离 Hono 类型依赖（`ContentfulStatusCode` → `number`）
  - `workspace.service.ts` 使用 `AppError` 替代 `status()` — 业务层不再知道 HTTP 框架
  - `app.ts` 简化至 35 行纯 `.use()` 拼装，零业务路径知识
  - Validation handling 移到 root error handler 统一兜底（`validation_error` code），删除 `createValidationProfileResolver` / `ValidationRouteProfile` 等绑定机制
- [x] (2026-05-10 19:15 local) Round 3 — 彻底扁平化，按 Elysia 最佳实践到终局形态：
  - `abstract class` + `static` 方法 → 纯模块函数（`export function list()`, `export function get(id)`）
  - 删除 `WorkspaceStore`、`PreferencesConfig`、`PreferencesStore`、`WorkspaceFiles` class（逻辑全部内联到 service.ts / files.ts 的 plain functions）
  - Controller 调用: `import * as Workspace from './service'` → `Workspace.list()`
  - 目录结构收敛为 `index.ts` (Elysia controller) + `model.ts` (TypeBox schemas) + `service.ts` (plain functions)
  - 连带修了旧 Hono 消费方: git.service.ts、pack-codebase.service.ts、app.module.ts、server-services.ts
- [ ] Milestone 2: 迁移 schema-first CRUD route，并恢复稳定 OpenAPI 生成。
- [ ] Milestone 3: 迁移流式与长生命周期 route（chat-runtime、pty、observability、issue-agent）。
- [ ] Milestone 4: 删除 Tsuki、删除 `packages/openapi`、更新测试和文档并完成端到端验收。

## Surprises & Discoveries

- Observation: `apps/web` 和 `apps/server` 的主要冲突点不是 REST 或 SSE 协议，而是 OpenAPI/codegen 链的失真。
  Evidence: `apps/web/openapi-ts.config.ts` 直接消费 `http://localhost:21423/openapi.json`；`apps/web/src/features/kanban/use-kanban.ts`、`apps/web/src/features/search/global-search-dialog.tsx` 等位置已经为生成错误写了旁路；`packages/openapi/src/index.ts` 对无法展开的 query/body 会回退到 `arg${index}` 或 primitive schema。

- Observation: 当前 `apps/server` 对 Tsuki 的耦合远重于对 Hono 的耦合。
  Evidence: `apps/server/src/app.module.ts`、`apps/server/src/app.factory.ts` 和所有 `apps/server/src/modules/*/*.controller.ts` 都依赖 `@Module/@Controller/@Body/@Query/@Param`；真正直接依赖 Hono 的地方只有 bootstrap carrier 和少量 `Response` 返回。

- Observation: Elysia 在 Node.js 下可以通过 `@elysia/node` 适配器运行，因此运行时平台不是本次迁移的主要风险。
  Evidence: `https://elysiajs.com/integrations/node.md` 明确给出 `new Elysia({ adapter: node() })` 的 Node 运行方式。

- Observation: `packages/openapi` 是 Tsuki metadata 专属桥，不存在“低成本复用到 Elysia”的自然路径。
  Evidence: `packages/openapi/src/index.ts` 直接调用 `getControllerMetadata`、`getRoutesMetadata`、`getRouteArgsMetadata`、`getZodSchema` 等 Tsuki API；这些元数据源在 Elysia 中不存在。

- Observation: 当前基线并不完全干净，迁移开始前需要先收敛或至少记录现有失败，否则后续无法判断新旧问题。
  Evidence: 诊断中 `apps/server/src/modules/secrets/secrets.controller.ts` 和 `apps/server/src/modules/profiles/profiles.controller.ts` 存在 import/type 问题，`apps/web/src/features/devtool/observability/observability-event-detail.tsx` 存在 Tailwind lint 问题。

- Observation: Elysia Node adapter 的真实 npm 包名与文档中展示的包名不一致。
  Evidence: `pnpm add elysia @elysia/node @elysia/openapi` 返回 404；`pnpm view @elysiajs/node version` 可正常返回 `1.4.5`，随后安装 `elysia @elysiajs/node @elysia/openapi` 成功。

- Observation: 当前 `apps/server` 的完整测试与构建可以容纳一个平行 Elysia skeleton，只要不替换现有 Tsuki 入口。
  Evidence: 在新增 `apps/server/src/app.ts`、`src/http/*`、`health.routes.ts` 与 `elysia-skeleton.test.ts` 后，`cd apps/server && pnpm test && pnpm build` 全部通过。

- Observation: `preferences` 是最适合作为第一个真实 feature 迁移切片的对象，但它暴露了一个必须先解决的系统问题：schema-first 与现有 feature-owned 结构化错误语义如何统一。
  Evidence: `preferences.types.ts` 已有真实 `chatPreferencesSchema`，`preferences.service.ts` 仍通过 `safeParse` 产出 `invalid_preferences_input`，而新的 `http/error-mapping.ts` 目前只认识 `AppError`，尚未归一化 Elysia 原生 validation error。

- Observation: 一旦用户要求直接切到 `Elysia.t / TypeBox`，平行 skeleton 也必须同步切换，否则后续 feature 会出现“骨架用一种 schema，真实 route 用另一种 schema”的分裂。
  Evidence: `apps/server/src/modules/health/health.contract.ts` 已从 Zod 改成 `t.Object(...)`，`apps/server/src/http/openapi.ts` 也移除了 Zod JSON Schema 映射；切换后 skeleton 测试和 typecheck 仍然通过。

- Observation: Elysia 的 validation normalization 若仅作为 `.use(plugin)` 注入，未必能拦到 route body validation；把 `onError` 直接注册到根 app 更可靠。
  Evidence: `createErrorMappingPlugin()` 形式下 `PUT /preferences/chat` invalid payload 仍返回框架默认 422 body；改为 `createServerApp(...).onError(createErrorHandler(...))` 后，同一测试稳定返回 `invalid_preferences_input` + 400 envelope。

- Observation: `Elysia.t / TypeBox` 的 union schema 在默认 `normalize=true`（exact-mirror）路径下会踩到上游 `TypeCompiler` 参数错位问题；切到 `normalize: 'typebox'` 可以保留正确 schema，同时避开该噪音。
  Evidence: 直接用 `t.Union([t.String(), t.Boolean()])`/`t.Nullable(t.String())` 时触发 exact-mirror 的 `TypeBox's TypeCompiler is required to use Union` 警告；在 `src/app.ts` 上设置 `normalize: 'typebox'` 后，`preferences` schema 与测试均正常工作。

- Observation: `workspace` 迁到 Elysia 后，真正需要补的不是业务逻辑，而是“路由语义如何在没有装饰器的前提下显式绑定到 validation envelope”。
  Evidence: `workspace.service.ts` 和 `workspace.files.ts` 已经完整承载 CRUD、409 duplicate-path 和文件系统安全边界；新增的工作主要集中在 `workspace.routes.ts` 的 TypeBox schema、`src/http/validation.ts` 的 path/regex profile matching，以及 `src/app.ts` 的显式依赖装配。

## Decision Log

- Decision: 采用破坏性重构，最终不保留 Tsuki runtime、装饰器 controller、`@Module` 组织和 `packages/openapi` 兼容桥。
  Rationale: 当前程序尚未发布，兼容层只会把旧问题带入新架构。目标是干净、显式、可维护，而不是双栈共存。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 第一阶段继续把 OpenAPI 作为 `apps/web` 与 `apps/server` 的主集成边界，不在同一计划里同时切到 Eden。
  Rationale: 现有 `apps/web` 已经围绕 `@hey-api/openapi-ts` 建立了大量 hooks、SDK 和 React Query 调用。若在同一次迁移里同时切换框架和 client contract 模型，会把风险叠加到无法定位。先稳定 OpenAPI，后续若要评估 Eden，再另开计划。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 保留现有 feature 目录与业务服务层，重建的是 HTTP 外壳和组合方式，而不是重写全部业务逻辑。
  Rationale: `apps/server/src/modules/*/*.service.ts`、`*.store.ts`、数据库与 provider 逻辑大多不依赖 Tsuki。最合理的做法是复用 owner-owned 业务代码，只删除 Tsuki-specific adapter。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 新的 Elysia 服务端采用“显式 composition root + feature-owned route factory”，不用 class-based HTTP controller，也不复制 `@Module`/DI 容器语义。
  Rationale: Elysia best practice 明确建议“1 Elysia instance = 1 controller”，并避免把整个 `Context` 传给 class controller。仓库自己的架构偏好也强调显式、透明、数据驱动，这与 route factory 更一致。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 根据用户的破坏性重构指令，迁移路径不再保守沿用 Zod，而是直接切到 `Elysia.t / TypeBox` 作为新 HTTP 路径的 schema 系统。
  Rationale: 用户明确要求“直接换，换成 Elysia.t / TypeBox”，并允许破坏性重构。继续在新路径保留 Zod 只会形成双 schema 心智模型，延长迁移时间并增加中间态复杂度。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 保持现有对外文档地址稳定，至少继续提供 `/openapi.json`、`/docs/openapi.json`、`/docs`。
  Rationale: `apps/web/openapi-ts.config.ts`、现有测试和开发者习惯都依赖这些路径。Elysia OpenAPI plugin 默认路径不同，但可以通过配置或别名 route 保持稳定，减少前端与文档面不必要的 churn。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 构建工具与开发脚本不作为本计划的主变量；除非实现阶段证明 `nodemon`/`vite build` 无法承载 Elysia Node adapter，否则先保持现有 `apps/server/package.json` 的 dev/build 形态。
  Rationale: 当前迁移的核心风险在 HTTP/runtime 架构，不在 bundler。把脚本栈一起改掉会模糊问题来源。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 下一阶段先系统化共享 HTTP 语义层，尤其是 validation normalization，再迁 `preferences`；不先迁 SSE、`workspace` 共享前缀族或其他长生命周期 feature。
  Rationale: `openapi` 路径兼容已经在 skeleton 中成立，但 `validation -> AppError` 的统一规则尚未建立。`preferences` 既足够小，又自带真实 schema 和现有结构化错误语义，是验证这条规则的最佳切片；相对地，`workspace` 与 `git`/`pack-codebase` 共享前缀，更适合在第二批次处理。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 保持 feature 默认目标形态为 `*.routes.ts` + `*.service.ts` + `*.store.ts` + `*.contract.ts`，但不把“每个 feature 必须只有一个 routes 文件”当成硬规则。
  Rationale: owner 边界比文件形状更重要。`issue-agent`、`workspace` 这类 capability 天然可能拆成多段 route surface；本计划要避免为了追求目录整齐而重新制造隐式 module DSL。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: validation normalization 采用“HTTP 层统一 issue 格式 + composition root 显式绑定 route profile”的最小方案，而不是再发明一套 schema-level DSL。
  Rationale: Elysia 已经提供原生 `ValidationError`，我们真正缺的是稳定 envelope 和 feature 级错误语义。把通用归一化放在 `src/http/validation.ts`，再由 `src/app.ts` 通过 path+method profile 绑定 `invalid_preferences_input`，既保持显式组合，也避免把 feature 语义塞进框架黑盒。
  Date/Author: 2026-05-10 / GitHub Copilot

- Decision: 对带 path param 的 workspace route，validation profile matching 只增加显式 regex 支持，不引入新的 route metadata DSL。
  Rationale: `PATCH /workspaces/:id` 与 `GET/PUT /workspaces/:id/files/content` 必须在 composition root 中绑定到 `invalid_workspace_input`，但完整的 route template parser 会把共享 HTTP 层做重；regex 足够表达当前需求，也保持了“显式、透明”的架构目标。
  Date/Author: 2026-05-10 / GitHub Copilot

## Outcomes & Retrospective

### Finalized Module Architecture (Round 3 终局形态)

每个 Elysia feature module 由 3 个文件组成，零 class、零 constructor、零 DI：

**目录结构**

```
modules/<feature>/
  index.ts    — Elysia controller (纯路由声明)
  model.ts    — TypeBox schemas (request/response 验证)
  service.ts  — plain exported functions (业务逻辑)
  files.ts    — (可选) plain exported functions (文件系统操作)
```

**index.ts (controller)**

```typescript
import { Elysia, t } from 'elysia'
import { FeatureModel } from './model'
import * as Feature from './service'

export const feature = new Elysia({ prefix: '/feature', detail: { tags: ['feature'] } })
  .get('', () => Feature.list(), {
    detail: { summary: 'List items' },
    response: { 200: t.Array(FeatureModel.record) },
  })
  .post('', ({ body }) => Feature.create(body), {
    body: FeatureModel.createBody,
    response: { 200: FeatureModel.record },
  })
```

**model.ts (TypeBox schemas)**

```typescript
import type { Static } from 'elysia'
import { t } from 'elysia'

export const FeatureModel = {
  record: t.Object({ id: t.String(), name: t.String() }),
  createBody: t.Object({ name: t.String({ minLength: 1 }) }),
} as const

```

**service.ts (plain functions)**

```typescript
import { db } from '../../infra'
import { featureTable } from '@cradle/db'

export function list() {
  return db().select().from(featureTable).all()
}

export function create(input: { name: string }) {
  return db().insert(featureTable).values({ id: randomUUID(), ...input }).returning().get()
}
```

**关键约束**
- service.ts 里 **不** import elysia —— 业务层不知道 HTTP 框架
- 抛 HTTP 错误用 `AppError`，不用 `status()`
- infra 只用 `db()` 和 `getServerConfig()` —— 不 new 基础设施
- app.ts 只做 `.use(feature)`，对 feature 零知识
- validation 由 root error handler 统一兜底（`validation_error`）

Milestone 0 已经完成，而且结果比预期更干净：我们没有触碰现有 Tsuki 生产路径，就已经在 `apps/server/src/app.ts` 下建立了一个可运行的平行 Elysia skeleton，并通过 `elysia-skeleton.test.ts` 证明它能稳定暴露 `/health`、`/openapi.json`、`/docs/openapi.json` 和 `/docs`。更关键的是，新增这条平行路径后，`apps/server` 现有 49 个测试、完整 typecheck 和 build 仍然全绿，说明“先并行再吞掉旧壳”的策略是可行的。

当前仍未完成的部分是 Milestone 1 以后真正困难的内容：显式 composition root 还只覆盖了 skeleton，没有接手现有的 database/service/store 图；feature 级 route 也只迁了 `health`。但我们已经有了一个安全的落脚点，不再需要从纯设计文档直接跳到全量替换。

当前状态比 Milestone 0 更进一步：`preferences` 已经成为第一个真实的 Elysia JSON feature slice，证明这条路径不只会暴露 `/health` 和 docs，还能承接真实文件持久化、结构化 invalid payload 语义以及 OpenAPI 文档。与此同时，`src/http/validation.ts` 已经把 Elysia 原生 validation error 收敛为仓库可接受的 envelope，后续迁移 `workspace`、`session` 这类 CRUD feature 时可以直接复用这一层，而不用每个 feature 再各自发明错误格式。

当前状态再次推进了一步：`workspace` 已经成为第二个真实的 Elysia feature slice，而且是第一个带数据库持久化、duplicate-path 409 语义、动态 path 参数和文件系统安全边界的切片。它验证了显式 composition root 不只是能接文件型 feature（`preferences`），也能显式串起 SQLite migration、Drizzle store、filesystem helper 与 feature-owned route factory，同时继续保留旧 Tsuki 路径给未迁移部分使用。

## Context and Orientation

本节把当前仓库里与本计划相关的部分全部解释清楚，假设执行者对仓库没有任何记忆。

`apps/server` 是 Cradle 的独立 HTTP 服务端包，代码位于 `apps/server/src/`。当前入口是 `apps/server/src/index.ts`，它读取 `apps/server/src/config/server-config.ts`，调用 `apps/server/src/app.factory.ts` 创建应用，再通过 `@hono/node-server` 启动监听。`apps/server/src/app.factory.ts` 先创建 Hono 实例，再调用 `@tsuki-hono/core` 的 `createApplication(AppModule, {}, hono)` 把 Tsuki metadata 注册到 Hono 上。`apps/server/src/app.module.ts` 是当前 composition root，它通过 `@Module({ imports: [...] })` 把 feature module 和全局 filter/middleware 组装到一起。

所谓 Tsuki，在这个仓库里指的是 `@tsuki-hono/common` 和 `@tsuki-hono/core` 提供的装饰器式 HTTP/DI 运行时。它的典型特征是：controller class 上用 `@Controller('path')`，方法上用 `@Get/@Post`，参数上用 `@Body/@Query/@Param`，module 用 `@Module` 聚合，再由 `createApplication` 根据 metadata 完成路由注册与依赖注入。当前所有 `apps/server/src/modules/*/*.controller.ts` 都采用这个模式。

当前 OpenAPI 生成不是 Elysia 或 Hono 原生提供的，而是仓库自己的 `packages/openapi`。`apps/server/src/openapi/openapi-routes.ts` 调用 `createOpenApiDocument(AppModule, ...)` 从 Tsuki metadata 反推 OpenAPI，再挂到 `/openapi.json`、`/docs/openapi.json` 和 `/docs`。`apps/web/openapi-ts.config.ts` 则把 `http://localhost:21423/openapi.json` 作为输入，用 `@hey-api/openapi-ts` 生成 `apps/web/src/api-gen/*`。这就是为什么 `apps/web` 和 `apps/server` 的契约问题集中出现在 codegen 层。

当前 `apps/web` 对服务端有两类调用。第一类是主干：绝大多数页面和 hooks 直接使用 `~/api-gen/sdk.gen` 或 `~/api-gen/@tanstack/react-query.gen`。第二类是旁路：聊天与 PTY 的流式接口，以及部分被 codegen 搞坏的 query/body 接口，会直接手写 `fetch`。这说明前端不是反对 HTTP，而是在反对“不可靠的生成产物”。

Elysia 在本计划里承担两个职责。第一，它是新的 HTTP 框架。第二，它提供 route-level schema-first 机制和 OpenAPI plugin，让 route 声明与契约声明放在同一处。Elysia best practice 的几个要点在本计划中是强制约束。`1 Elysia instance = 1 controller`，也就是每个 feature 导出一个 Elysia route instance 或 route factory；不要把整个 `Context` 传进 class controller；非 request-dependent 的业务逻辑应从 Elysia route 中分离出来，作为普通 service/store/function 复用；模型必须来自运行时 schema，而不是单独声明 TypeScript interface 再让运行时去猜。这个计划不会照搬 MVC 词汇，但会遵守这些原则。

所谓显式 composition root，指的是应用入口直接构造依赖对象，然后把这些依赖传给 feature route factory，而不是依靠 DI container 在运行时神秘地解析。例如目标形态应类似：`createServerApp({ db, logger, workspaceService, sessionService, ... })` 创建根 app，`createWorkspaceRoutes(deps)` 返回一个带 prefix 的 Elysia 实例，根 app 再 `.use(workspaceRoutes)`。这样执行者看到函数签名就知道依赖关系，不需要追 `@inject()` 和 provider token。

所谓 schema-first，在本仓库的第一阶段实现里指：每个 HTTP 输入与输出都必须由可运行的 schema 定义，优先复用现有 `*.contract.ts` 中的 Zod schema，必要时把目前只有 TypeScript type alias 的 body/query 参数升级为真实的 Zod schema。目标是让 OpenAPI 直接从这些 schema 产出，而不是再从 class parameter metadata 猜。

## Plan of Work

Milestone 0 的目标是先把地面扫平，再立起最小 Elysia skeleton。执行者先运行当前基线的 `apps/server` 与 repo 级验证命令，记录已有失败，尤其是 `secrets.controller.ts`、`profiles.controller.ts` 和 web 的 Tailwind lint 问题。若这些问题落在即将 touched 的文件里，就在迁移开始前先修掉；若不在第一批 touched 范围，则在计划里明确列出，避免之后把旧错当新错。接着在 `apps/server` 引入 `elysia`、`@elysia/node`、`@elysia/openapi`，建立一个新的 `createServerApp` skeleton，只接入 `health`、请求 ID、基础错误映射和 OpenAPI 文档，先证明在不依赖 Tsuki 的情况下可以用 Elysia 暴露稳定的 `/health`、`/openapi.json` 和 `/docs`。这一里程碑结束时，旧 Tsuki app 仍可存在，但只能作为短命 scaffolding，不允许继续在其上添加新功能。

Milestone 1 的目标是建立新的显式 composition root 和跨 feature 共享依赖。这里要删掉对 `AppModule`、`@Module`、`APP_FILTER`、`APP_MIDDLEWARE` 的依赖，改为普通 TypeScript composition。执行者应在 `apps/server/src/` 下引入新的 HTTP 组织层，例如 `app.ts`、`http/` 或等价命名的目录，里面只放 Elysia-specific 插件、错误映射、OpenAPI 配置和根 app 组合逻辑。现有的 `Logger`、数据库访问、config loader、service/store 实例化需要被明确串起来。若某个 feature service 目前依赖 `tsyringe` 才能工作，应优先在这一里程碑里把它改成显式构造，而不是把 Tsyringe 再套进 Elysia。此时还不追求全量业务迁移，但要让执行者能够看见目标依赖图：哪些 store/service 是进程级 singleton，哪些是 route-level helper，哪些 route factory 接收哪些依赖。

Milestone 2 的目标是优先迁移最容易证明契约收益的 CRUD route，并让 OpenAPI 恢复可信。建议先迁 `health`、`preferences`、`workspace`、`session`、`profiles`、`secrets`、`providers` 这类主要返回 JSON 的 capability，因为它们最能暴露 `arg0`/`body: string` 问题。每个 feature 目录里删除 `*.controller.ts` 的 Tsuki 装饰器模式，改成 Elysia route factory，例如 `workspace.routes.ts` 或 feature 约定的 `index.ts`，同时让 `*.contract.ts` 成为唯一 schema 来源：request body、query、path params、response 都要来自运行时 schema。迁完一个 feature 就立刻运行 `apps/server` 的对应测试，并在适当的时候从 `apps/web` 执行 `pnpm generate` 验证生成产物不再退化。Milestone 2 结束时，OpenAPI 必须由 Elysia plugin 产出，且对已迁 feature 的 SDK 签名稳定可用。

Milestone 3 的目标是迁移长生命周期和流式能力，也就是最容易“看起来通了、其实坏了”的部分。重点包括 `chat-runtime`、`pty`、`observability`、`issue-agent` 以及任何 SSE endpoint。这里的实现重点不是 route 声明，而是行为一致性：event name、event payload、abort 时序、timeline 拉取、stream 关闭条件必须与当前 web 期望兼容，至少在第一阶段不能破坏现有 UI。因为 Elysia 对 WebSocket 有一整套模型，但当前 Cradle web 侧主要使用 SSE，所以本计划不引入 WebSocket 替代 SSE。Elysia 在这些 route 上只充当更清晰的 HTTP/SSE 壳。Milestone 3 结束时，聊天发送、流式接收、终端 attach/resize/input、observability stream 等核心路径必须通过现有测试或新增行为测试。

Milestone 4 的目标是删除旧世界并完成收口。到这一步，执行者应彻底删除 `@tsuki-hono/common`、`@tsuki-hono/core`、`hono` carrier 的 Tsuki glue、`apps/server/src/app.module.ts`、旧 `*.controller.ts` 和 `packages/openapi`。若仍有旧 route 或旧 metadata helper 存活，说明重构没有完成。删除后要更新 `apps/server/package.json`、`apps/server/README.md`、`docs/exec-plans/README.md` 以及被 touched 目录的 README。最后执行完整验证：`apps/server` 的 test/typecheck/build，repo root 的 typecheck，以及 `apps/web` 的 `pnpm generate`。若这些全部通过，并且 `apps/web` 可以完成至少一个 workspace/session/chat 的用户可感知流程，本计划才算结束。

## Concrete Steps

所有命令默认在仓库根目录 `/Users/wibus/dev/Cradle` 执行，除非命令前明确写出 `cd apps/server` 或 `cd apps/web`。每完成一个 milestone，都必须回写本文件的 `Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective`。

1. 先记录当前基线，避免之后把旧问题误判成迁移回归：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm test && pnpm typecheck && pnpm build
       cd /Users/wibus/dev/Cradle && pnpm typecheck

   如果 `apps/server` 当前无法全绿，必须在本计划里补记失败点，并决定是立即修复还是明确延后。优先修复会被第一批 touched 的文件。

2. 安装 Elysia 运行时与 OpenAPI 插件，暂不删除 Tsuki 依赖：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm add elysia @elysia/node @elysia/openapi

   如果 pnpm 对 peer dependencies 有补充要求，按安装输出补齐。此时不要立刻删除 `@tsuki-hono/*`，直到 Milestone 4 再做最终清场。

3. 在 `apps/server/src/` 建立新的 Elysia skeleton。目标文件至少包括：

   - `apps/server/src/app.ts` 或 `apps/server/src/create-server-app.ts`：新的根 app factory。
   - `apps/server/src/http/request-id.ts`：请求 ID plugin 或 hook。
   - `apps/server/src/http/error-mapping.ts`：把现有 `AppError` 映射成统一 HTTP 响应。
   - `apps/server/src/http/openapi.ts`：Elysia OpenAPI plugin 配置，并保持 `/openapi.json`、`/docs/openapi.json`、`/docs` 对外可访问。
   - `apps/server/src/index.ts`：从新 app factory 启动 Node adapter，而不是 `@hono/node-server`。

   此阶段只需要 `health` 路由。运行：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm test -- --run health.test.ts openapi.test.ts

   期望先看到旧测试红在“启动方式不兼容”，然后补写或更新到新的 Elysia 测试支架。

4. 为显式 composition root 定义依赖对象。建议把所有进程级共享依赖集中在一个普通 TypeScript 对象里，例如：

       interface ServerDeps {
         config: ServerConfig
         logger: Logger
         database: DatabaseAccessor
         services: {
           workspace: WorkspaceService
           session: SessionService
           chatRuntime: ChatRuntimeService
           ...
         }
       }

   route factory 只接收自己需要的子集。执行者必须在本阶段删掉对 `AppModule` 和 `tsyringe` HTTP 注入的依赖，哪怕底层个别 service 暂时还是 class，也要由 composition root 显式 new 出来。

5. 开始迁移 CRUD feature。建议顺序是：`health` -> `preferences` -> `workspace` -> `session` -> `profiles` -> `secrets` -> `providers`。每迁一个 feature，都执行三步：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm test -- --run <对应测试文件>
       cd /Users/wibus/dev/Cradle/apps/web && pnpm generate
       cd /Users/wibus/dev/Cradle && pnpm typecheck

   迁移时要把原本只有 TypeScript type alias 的 body/query 升级成运行时 schema，优先复用或扩展 `*.contract.ts` 里的 Zod schema。不要再写“运行时一个 interface，验证时另一个 schema”的双轨模型。

6. 配置 Elysia OpenAPI plugin 使用 Zod 映射，确保 contract 文件是单一事实来源。执行者需要把当前 `apps/server/src/openapi/openapi-routes.ts` 的职责吸收到 Elysia app 初始化中，并在插件配置中保留现有 API title、version 和 docs path。若 `apps/web/openapi-ts.config.ts` 因路径变化无法直接工作，优先恢复兼容路径，而不是立刻修改前端生成配置。

7. 迁移流式 feature。建议顺序是：`chat-runtime` -> `pty` -> `observability` -> `issue-agent`。每个流式 feature 迁移后都必须做一个行为级验证：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm test -- --run chat-runtime.test.ts pty.test.ts observability.test.ts issue-agent.test.ts

   如有必要，可在 test 中直接用 `app.handle(new Request('http://localhost/...'))` 读取 `text/event-stream` 响应，验证 event 序列而不依赖浏览器。

8. 迁移剩余复杂 feature，例如 `kanban`、`acp`、`skills`、`search`、`usage`、`pack-codebase`、`git`。这一步需要特别留意 query 参数展开是否仍然在 OpenAPI 中正确命名；`kanban` 是当前最容易出现 `arg0` 的区域，必须通过 `apps/web` codegen 验证。

9. 当全部 feature 都已经通过 Elysia app 暴露后，执行彻底清场：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm remove @tsuki-hono/common @tsuki-hono/core @hono/node-server hono @scalar/hono-api-reference

   若 `packages/openapi` 已无调用方，也应从 repo 中删除对应包代码与依赖。删除后重新执行全量验证。

10. 更新文档与目录清单。至少更新以下文件：

   - `apps/server/README.md`
   - `docs/README.md`
   - `docs/exec-plans/README.md`
   - 被 touched 目录的 `README.md`

   并确认所有新增或大改的 `.ts` 文件都带有 `Input / Output / Position` header comment。

## Validation and Acceptance

本计划的验收不以“代码改完了”为标准，而以“用户与开发者观察到正确行为”为标准。

首先，`apps/server` 自己必须能单独验证。运行：

    cd /Users/wibus/dev/Cradle/apps/server && pnpm test && pnpm typecheck && pnpm build

期望测试、类型检查和构建全部通过。若有新增测试，必须包含至少以下几类：一类验证 `health` 与 docs route；一类验证 CRUD route 的 request/response schema 与 OpenAPI；一类验证 SSE 行为；一类验证错误映射。

其次，repo 级类型面必须继续成立。运行：

    cd /Users/wibus/dev/Cradle && pnpm typecheck

期望 root typecheck 通过，说明 web 与 server 的共享类型表面没有被新的服务端契约破坏。

再次，前端 codegen 必须恢复价值。运行：

    cd /Users/wibus/dev/Cradle/apps/web && pnpm generate

然后检查生成物，至少确认以下行为：迁移完成的 `workspace`、`session`、`kanban`、`providers` 等 endpoint 不再生成 `arg0` query 参数、不再把 JSON body 退化成 `string`，对应的 SDK 方法具备可读的 named options。必要时可以把具体断言写进自动化测试或 snapshot。

最后做用户可感知验证。启动 web 和 server 开发环境后，至少要手动验证：

1. 访问 `http://localhost:21423/health` 返回 200 和健康 JSON。
2. 访问 `http://localhost:21423/openapi.json` 与 `http://localhost:21423/docs` 可得到 JSON spec 和文档页面。
3. 在 `apps/web` 中打开 workspace 列表与 session 列表，说明基础 CRUD 契约仍然通。
4. 在聊天界面发送一条消息，确认 SSE 流和 timeline 拉取继续工作。
5. 在终端会话界面 attach 一个 PTY，确认 stream、input、resize、stop 行为继续工作。

若以上任一行为失效，本计划不得标记完成。

## Idempotence and Recovery

本计划允许破坏性重构，但破坏范围只限 `apps/server` 的代码、测试和 Cradle 自己的本地服务端数据目录，不允许改动用户 workspace 的仓库内容。所有迁移步骤都应以可重复执行为原则：`pnpm generate` 可以重复运行，`pnpm test/typecheck/build` 可以重复运行，重新启动 server 不应留下需要手工清理的中间状态。

实施期间若需要短命的并行 skeleton，可在同一分支中保留 `createServerApp` 与旧 `createConfiguredApp` 并存，但这只是迁移脚手架，不是兼容承诺。只要新 Elysia 路径能够覆盖某个 feature，旧 Tsuki 路径就应尽快删除，避免双写和双维护。

若某个步骤失败，优先按以下方式恢复：

- OpenAPI 产物异常：先检查 route schema 是否真实存在，再检查 Elysia OpenAPI 配置，不要去给 web 继续加 workaround。
- 流式接口异常：先用 `apps/server` 测试和最小 `Request` 验证 stream 行为，再看 web 侧消费，不要先怪浏览器。
- 大面积类型错误：先停在最近一个 feature milestone，保证局部变更可验证，再继续下一批 feature。
- 构建或 dev server 异常：先确认是 Elysia/Node adapter 问题还是现有 Vite/nodemon 问题。只有在确认当前脚本栈真的阻塞迁移时，才允许把脚本栈列入本计划修改范围。

## Artifacts and Notes

下面这些事实是执行者必须记住的，不应在实施时重新猜。

当前 `apps/server` 的外部文档入口与测试期望是：

    GET /health
    GET /openapi.json
    GET /docs/openapi.json
    GET /docs

当前 `apps/web` 生成客户端依赖的配置是：

    input: 'http://localhost:21423/openapi.json'

当前最典型的流式旁路是：

    apps/web/src/features/chat/sse-chat-transport.ts
    apps/web/src/features/tui/sse-pty-connector.ts

Elysia best practice 在本计划中的翻译规则如下：

1. 一个 feature route instance 就是一个 HTTP controller，不再写 class-based Elysia controller。
2. service/store 不接收整个 request context，只接收已经拆好的普通参数。
3. request-dependent 逻辑若必须抽象，使用 plugin/hook/decorate，但只装饰真正 request-dependent 的属性。
4. request body、query、params、response 必须来自运行时 schema；不要单独声明 interface 再让框架猜。

推荐的目标文件布局如下，执行者可按实际需要微调命名，但职责必须一致：

    apps/server/src/
      app.ts
      index.ts
      http/
        request-id.ts
        error-mapping.ts
        openapi.ts
      modules/
        workspace/
          workspace.routes.ts
          workspace.service.ts
          workspace.store.ts
          workspace.contract.ts
        session/
          session.routes.ts
          session.service.ts
          session.store.ts
          session.contract.ts

## Interfaces and Dependencies

本计划结束时，`apps/server` 至少应暴露以下稳定接口和依赖结构。

在 `apps/server/src/app.ts` 或等价文件中，必须存在一个显式根工厂，签名应接近：

    export interface ServerDeps {
      config: ServerConfig
      logger: Logger
      database: DatabaseAccessor
      services: {
        health: HealthServiceLike
        workspace: WorkspaceService
        session: SessionService
        chatRuntime: ChatRuntimeService
        pty: PtyService
        ...
      }
    }

    export function createServerApp(deps?: Partial<ServerDeps>): Elysia

在每个 feature 目录中，必须存在 feature-owned route factory，签名应接近：

    export function createWorkspaceRoutes(deps: {
      workspaceService: WorkspaceService
      logger: Logger
    }): Elysia

它返回的对象必须是一个带 prefix 的 Elysia instance，并直接在 route options 里声明 `params`、`query`、`body`、`response` schema。route handler 内不要再传整个 context 给 service。

在 OpenAPI 层，必须使用 Elysia 官方 OpenAPI plugin，并启用 Zod schema 映射。第一阶段允许继续使用 Zod 4 的 `toJSONSchema` 作为 `mapJsonSchema.zod` 实现，前提是最终生成的 OpenAPI 能正确表达 request/response shape。任何新的 contract 文件都必须优先复用已有 `*.contract.ts` 的 schema，而不是重新造平行 DTO。

在运行时依赖层，`apps/server/package.json` 最终必须至少包含：

    elysia
    @elysia/node
    @elysia/openapi
    zod
    drizzle-orm
    better-sqlite3

最终状态下，不应再依赖：

    @tsuki-hono/common
    @tsuki-hono/core
    @hono/node-server
    packages/openapi

测试接口也必须改变。现有大量测试使用 `createConfiguredApp().getInstance().request(...)` 或 `createApplication(BoomModule)`。迁移完成后，测试应围绕新的 Elysia app factory 进行，优先使用 WinterTC 风格的 `app.handle(new Request('http://localhost/...'))` 或等价接口，确保 HTTP 语义与真实运行一致。

Revision Note 2026-05-10: Initial ExecPlan created for route-B destructive migration from Tsuki/Hono metadata runtime to Elysia-powered `apps/server`, based on current repo inspection and Elysia best-practice research.

Revision Note 2026-05-10 07:40Z: Updated living sections after completing Milestone 0 with a parallel Elysia skeleton, green server validation, and the npm package-name discovery for the Node adapter.