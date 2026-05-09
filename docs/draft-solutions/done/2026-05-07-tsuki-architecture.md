# Migrate Cradle IPC Server to Tsuki/Hono Architecture

全程以此文档为指导，按照下面的迁移方案执行。迁移过程中必须严格遵循以下原则：

> 整个迁移过程必须激活 Skills 执行。包括 Sub Agent 也需要激活 Skills 来指导调查、设计、实现和验证。迁移不是靠感觉走的，而是一个有明确步骤和检查点的 workflow。全程遵循  Rules，确保每个阶段都有充分的调查和验证，避免错误边界进入新架构。

注意，如果需要先做基建的话，那就先做，先不要写核心功能那就。

对于一些如果可以复制粘贴就能完成的功能实现，是可以直接复制粘贴的，但是先分析它的行为、输入输出、依赖和副作用，确认它的行为和能力边界后再复制粘贴到新架构里，并且要在新架构里把它的能力边界设计清楚，不要让它的能力边界模糊不清。

对于数据库 Schema 的迁移，原则上可以直接复制粘贴现有的 Schema 定义到新的架构里，请注意，务必要做到 Drizzle 的最佳实践，全部数据库相关操作都只能走 drizzle-kit

注意，这里面可能已经有一些步骤或者东西已经迁移完成了，如果完成了的就可以忽略了。你务必要观察清楚当前的状态，来判断哪些步骤是已经完成了的，哪些步骤是还没有完成的，来决定你接下来要执行哪些步骤，来推进迁移的进度。不要做了又做，明明是新的又要说是旧的。。

代码都按照最现代的架构组织。。。我下面说的很有可能是不符合现代架构的了，你要自己分析了，来决定怎么改成现代架构的，来决定怎么组织代码的，来决定怎么设计模块的，来决定怎么设计 provider 的，来决定怎么设计 route handler 的，来决定怎么设计测试的，来决定怎么设计兼容层的，来决定怎么设计生命周期管理的，来决定怎么设计事件处理的，来决定怎么设计依赖注入的。。。

首先是不要丢 capability，而是 modules 里放。。。。

## 我给你的一封信

Hi, Lead Agent,

当你启动了之后，你得知道，这个时候，我已经离开电脑前了，你要做的是把这个迁移方案执行完，来完成我们的迁移工作。

总之，有关架构上的选择，你可以去看源码，我已经给了你两个项目的地址了，你可以去看，去分析，去理解，去学习，去借鉴，去复制粘贴，去实现。

至于执行方案上，必然是选择 Subagent-driven 的开发，同时 Leader Agent 需要全程参与，来指导整个迁移过程，来监督整个迁移过程，来审核每个阶段的产物，来保证迁移的质量。不需要使用 git worktrees 开发分支，直接在主分支上开发就好了。至于 Plans 和 Specs 的话，你写完 Spec 了，就直接写 Plan 来指导实现就好了，不需要等我的指令了，因为我没法回复你了，你要自己来执行这个迁移方案了。

反正，如果有不确定的，就让子代理去四处调查、互联网、代码库、文档，来找到答案，来消除不确定性，来推进迁移的进度。最终我只需要一个很不错的现代架构即可～

最后迁移出来到 HTTP Server 就好了，至于 Electron IPC 的兼容层的话，先不急着做，等核心架构和核心能力都迁移完了之后，再来做兼容层的设计和实现也不迟。也不需要管旧入口、旧调用了，先把新架构和新能力做好了再说。

Best of luck, Lead Agent. I trust you to execute this plan well and deliver a great new architecture for Cradle.

Best,
Wibus.

## Always:

- ...previous instructions and context.
- Load `/Users/wibus/dev/Tsuki/CLAUDE.md`.

## Overview

随着 Cradle 的发展，当前的 Electron IPC Server 架构已经逐渐暴露出结构性问题。我们计划将其迁移到基于 Tsuki/Hono 的架构，利用其模块化设计和依赖注入机制，构建一个更清晰、可维护的服务器架构，并为未来的功能扩展打下更好的基础。

> 如果你发现了 Tsuki 的机制有疑惑，可以直接前往 `/Users/wibus/dev/Tsuki` 查看源码。如果你觉得 Tsuki 缺少某些能力，请在 `docs/tsuki-issues/` 下创建 markdown 文件，描述你遇到的问题、理想状态，以及你期望 Tsuki 提供什么功能来支持它。
>
> 使用 Tsuki 的项目： `/Users/wibus/dev/afilmory/be`，如果你想看一个更完整的 Tsuki 应用示例，也可以参考这个项目。

## Current Target Architecture (Updated)

迁移后的 server 架构以**技术分组 + 业务模块**为主：

- **modules/**：所有产品能力（含 health）。
- **技术目录**：database/config/errors/filters/logging/middlewares 等只负责横切与基础设施。
- **依赖方向**：modules → infra/tech；infra 不能反向依赖 modules。
- **AppModule**：只做组合（imports + 全局 middleware/filter 注册），不塞业务逻辑。

目标布局（概念图）：

```
apps/server/src/
  app.module.ts
  app.factory.ts
  index.ts

  modules/
    health/
    workspace/
    session/
    agent-identity/

  database/
  redis/
  config/
  errors/
  filters/
  logging/
  middlewares/
  pipes/
  guards/
  interceptors/
  helpers/
  openapi/
```

## Why Migrate?

现在真正卡住的是：Cradle 现在还是按"桌面应用"在长，但我心里想做的东西已经不应该是围绕着 Electron IPC 来展开了。

当前主进程架构的核心路径是：`main.ts` 做 composition root → `createServices([...])` 统一注册各个 Service → 各 Service 挂到 Electron IPC / socket 上。这套机制在最初是很美好的，但现在已经开始崩了。

**1. Service 已经不再是"简单可 new 的薄适配器"**

最早这套机制默认一个 Service 无参构造、注册几个方法就完事了。但现在很多 Service 开始需要 runtime 依赖、生命周期依赖、事件总线依赖、其他模块实例依赖。于是 `createServices([...])` 这种"丢几个类进去统一注册"的模型就开始失真。

**2. main.ts 正在变成依赖装配垃圾场**

每加一个稍微复杂点的 Service，`main.ts` 就要多做一层：先 `new` 某个 runtime，再绑定事件，再塞进某个 Service，再把这个 Service 混进注册列表。结果 `main.ts` 同时承载了：对象图、生命周期、跨模块 wiring、transport 注册——全都糊在一起。

**3. Service 这个名字已经在偷换概念**

现在的很多 Service 混了几层身份：应用服务、transport adapter、lifecycle owner、事件桥。你以为你在注册"Service"，其实你在注册几种完全不同性质的东西。

**4. 一旦依赖不是无参构造，注册机制就开始破相**

IssueAgentService 就是例子：不能再靠简单 class 注册，需要先构造 runtime，再注入 service，最后还得让 `createServices()` 兼容 instance。这说明原来的注册抽象正在失效。

**5. 同一套 Service map 还被拿去喂 socket / IPC**

现在不只是 Electron IPC 在吃它，socket 也在反射调用这一套东西。于是你根本分不清这是 app boundary、transport boundary 还是 convenience registry——这就是结构性塌陷的前兆。

---

## Core Direction: Capability Reconstruction, Not Service Migration

**这次迁移不是 Service migration，而是 capability reconstruction。**

新架构边界由 Capability SPEC 决定，而不是旧 Service 的形状。

这个 reconstruction 不应该由一个 Agent 靠直觉一路改完。它必须是一个 **Leader Agent 驱动的、多 Sub Agent 并行调查和执行的 workflow**：

- Leader Agent 负责：任务拆解、SPEC 审核、边界判断、最终验收
- Sub Agent 负责：对具体旧代码、调用链、依赖、副作用、测试和实现细节做充分调查

**单 Agent 直接从旧 Service 改到新 Module 是禁止路径。**

---

## Migration Phases

### Phase 0: Setup Tsuki/Hono Package

在 monorepo 中创建新 apps `apps/server`，配置 Tsuki/Hono 作为服务器框架。

技术要求：
- TypeScript 支持
- Hot Reloading 支持
- Vitest 支持
- 现代打包器（Vite）

> New Notes: DB Schema Migration 已经基本上完成了一大半了，packages/db 里已经有了 Drizzle 的 schema 定义了，不要再复制来复制去了，这个地方就是对的地方，直接在这个基础上继续完善就好了。具体有不懂的看 Afilmory 这个项目里是怎么用怎么搞的就好了。。

### Phase 1: Bootstrap Server Architecture

> **执行者：Sub Agent（由 Leader Agent Spawn）**

Leader Agent Spawn 一个 **Bootstrap Sub Agent**，负责：
- 设计新的服务器架构，明确模块划分和职责分工
- 搭建基础服务框架，确保 Tsuki/Hono 能够正常运行并处理基本请求
- 先不要急着迁移现有的 Service，先把新的架构基础站起来

Sub Agent 产物（Leader Agent 验收）：
- 可运行的 `apps/server` 最小 skeleton
- sample module，验证 module / provider / route / test 基本形态
- 服务器能够启动并响应基本请求，开发工具和流程完善

### Phase 2: Inventory Legacy System

> **执行者：Sub Agent（由 Leader Agent Spawn，可并行）**

Leader Agent Spawn **Legacy Inventory Sub Agent**，负责：
- 以旧 Service 为**考古材料**，理解现有行为、依赖和副作用
- 目标不是按旧 Service 形状搬代码，而是识别出对应的产品能力

Sub Agent 同时推进两条线：

1. 调查旧系统中所有 Service / IPC / socket 的边界和行为
2. 从用户可见功能和系统能力出发，梳理出一组待重建的 Capability 列表

Sub Agent 产物（Leader Agent 验收）：
- `apps/server/specs/capabilities/index.md` — 第一批 Capability 列表
- `apps/server/specs/legacy-service-inventory.md` — 旧 Service 证据清单

### Phase 3: Rebuild One Capability at a Time

实现必须逐个 Capability 做。不要一次迁移一整组 Service，也不要把一个旧 Service 原样搬成一个新 Module。

每个 Capability 都走同一个 Leader Agent 编排的流程（详见 [Per-Capability Reconstruction Workflow](#per-capability-reconstruction-workflow)）：

1. Leader Agent 激活 Skills，进行下列操作
2. Spawn **Architecture Explorer Sub Agent** — 调查 Tsuki/Hono 目标架构约束
3. Spawn **Legacy Behavior Explorer Sub Agent** — 调查旧行为、调用链、输入输出和兼容要求
4. Spawn **Dependency / Side Effect Explorer Sub Agent** — 调查依赖、生命周期、事件和副作用
5. Leader Agent 汇总结果，判断哪些是产品语义，哪些是旧实现泄漏
6. Spawn **Capability SPEC Writer Sub Agent** — 写 Capability SPEC
7. Leader Agent 审核 SPEC，确认边界正确后进入实现
8. Spawn **Implementation Sub Agent** — 根据 SPEC 实现 Tsuki Module / Provider / Adapter
9. Spawn **Test / Verification Sub Agent** — 写测试并验证行为
10. Spawn **Review / Cutover Sub Agent** — 检查旧入口、兼容层和删除计划
11. Leader Agent 做最终验收，删除或降级旧 Service 入口

---

## Agent Workflow

### Role Overview

```text
Leader Agent
  ├── Bootstrap Sub Agent (Phase 1)
  ├── Legacy Inventory Sub Agent (Phase 2)
  ├── Architecture Explorer Sub Agent
  ├── Legacy Behavior Explorer Sub Agent
  ├── Dependency / Side Effect Explorer Sub Agent
  ├── Capability SPEC Writer Sub Agent
  ├── Implementation Sub Agent
  ├── Test / Verification Sub Agent
  └── Review / Cutover Sub Agent
```

### Leader Agent

Leader Agent 不应该直接一上来改代码。最重要的职责是**防止错误边界进入新架构**。

职责：
- 读取迁移目标和当前上下文
- 激活 skill，指导自己和 Sub Agent 的调查和执行
- 根据目标选择合适的skill
- 创建任务计划，Spawn Sub Agents，给每个 Sub Agent 明确的 investigation scope
- 收集 Sub Agent 的结果，判断旧 Service 暴露出来的是产品语义还是实现泄漏
- 审核 Capability SPEC，决定目标 Module 边界
- 决定是否允许进入实现阶段
- 最终验收实现和 cutover

### Architecture Explorer Sub Agent

负责理解新架构约束。

调查内容：
- Tsuki 当前 module / provider / lifecycle 的真实能力
- Tsuki 的依赖注入和事件机制能支持哪些设计，不能支持哪些设计
- server runtime 的 bootstrap 应该怎么组织
- 新 Module 应该如何声明依赖
- 如果 Tsuki 缺能力，在 `docs/tsuki-issues/` 下记录问题
- 可以从 /Users/wibus/dev/afilmory/be 这个 Tsuki 应用里找到很多实践例子
- 看看 Tsuki 是否已经有对应的能力可以实现了，如果是这样的话，那就不需要我们继续来编码了，直接用就好了

产物：`Architecture Notes` / `Target Module Constraints` / `Tsuki Issues (if any)`

### Legacy Behavior Explorer Sub Agent

负责考古旧行为。不设计新架构，也不写新实现，只回答：

- 旧系统现在实际有哪些行为，这些行为从哪里被调用
- IPC channel / socket event / renderer API 是什么
- 当前输入输出是什么，错误行为是什么
- 有没有测试覆盖，有没有隐含兼容要求

产物：`Legacy Behavior Evidence` / `Call Graph Notes` / `Input/Output Evidence` / `Compatibility Requirements`

### Dependency / Side Effect Explorer Sub Agent

专门调查依赖和副作用。回答：

- 旧 Service 依赖哪些 runtime，哪些是真需求，哪些只是旧架构 glue
- 有没有文件系统读写、Git / shell / subprocess 调用、LLM 调用、数据库或缓存
- 有没有事件订阅和发布，有没有长生命周期状态
- 有没有并发、取消、重试、streaming 等行为

产物：`Dependency Map` / `Side Effect Map` / `Lifecycle Notes` / `Risk Notes`

### Capability SPEC Writer Sub Agent

基于前面几个 Sub Agent 的调查结果写 SPEC。不能只根据旧 Service 名字写 SPEC，必须从 capability 出发，明确：

User / System Goal、Current Behavior Evidence、Current Inputs/Outputs、Side Effects、Dependencies、Domain Model、Target API、Target Module Design、Events、Compatibility Requirements、Test Plan、Cutover Plan

产物：`apps/server/specs/capabilities/<capability-name>.md`

### Implementation Sub Agent

只有在 SPEC 被 Leader Agent 接受之后才能开始。

职责：
- 按 SPEC 实现新的 Module，只复用经过确认的旧代码片段
- 不照搬旧 Service 边界，不在 route handler 里堆业务逻辑
- 不把 compatibility adapter 做成新的架构中心
- 如果实现中发现 SPEC 不完整，停止并把问题反馈给 Leader Agent

产物：`Target Module Implementation` / `Provider Implementation` / `Adapter Implementation` / `Compatibility Bridge (if needed)`

### Test / Verification Sub Agent

验证实现是否满足 SPEC，覆盖：Module-level tests、Provider tests、Hono route tests、compatibility tests、lifecycle tests、side effect tests、regression tests for old behavior

产物：`Test Plan Result` / `Regression Notes` / `Verification Report`

### Review / Cutover Sub Agent

负责最后检查旧入口是否可以删除、冻结或降级。回答：

- 旧 IPC / socket / Service 入口是否仍被调用
- 兼容层是否只调用新 Module，是否还有业务逻辑留在旧 Service
- 旧代码是否可以删除，如果不能，原因是什么

产物：`Cutover Report` / `Legacy Removal Plan` / `Deprecation Notes`

---

## Per-Capability Reconstruction Workflow

每个 Capability 重建时，Sub Agent 必须按以下五步走，不得跳过。

### 1. Explore

调查该 Capability 的全貌：
- 这个功能现在解决什么问题，谁在调用它
- 旧系统中哪些 Service / IPC / socket / UI action 与它有关
- 当前输入输出是什么，哪些是真实产品语义，哪些只是旧实现泄漏
- 它是否有内部状态、生命周期、事件订阅/发布、副作用
- 旧代码里哪些部分应该复用，哪些应该丢弃

### 2. Classify

把旧代码证据分类：
- 核心能力 / transport adapter / 生命周期管理 / 事件桥接 / 副作用和缓存 / 临时 facade

### 3. Design Target Module

根据 Capability SPEC 设计新 Module：
- 这个 Module 代表哪个 Capability，需要哪些 Provider 和 Adapter
- 生命周期如何管理，事件如何处理
- 如何暴露 API

### 4. Implement

- 实现核心业务逻辑
- 实现兼容层 Adapter
- 编写测试

### 5. Cutover

- 验收功能正确

---

## Required Superpower Usage

迁移过程中必须显式使用 Skills，强迫 Agent 不要靠感觉迁移，而是按 workflow 做调查、计划、执行、验证和复盘。

要求：
- 开始任何 Capability 前，Leader Agent 必须先激活合适的 planning / investigation skill
- 写 SPEC 前，Sub Agent 必须使用 research / exploration 类 skill
- 写实现前，Implementation Sub Agent 必须使用 implementation planning skill
- 写测试前，Test Sub Agent 必须使用 verification / testing skill
- cutover 前，Review Sub Agent 必须使用 review / validation skill
- 如果发现 Tsuki 缺能力，必须记录 issue，而不是在迁移代码里硬绕过去

每个 Capability 的 workflow 文件里必须记录：

```markdown
## Superpowers Used

- Leader Agent:
- Architecture Explorer Sub Agent:
- Legacy Behavior Explorer Sub Agent:
- Dependency / Side Effect Explorer Sub Agent:
- Capability SPEC Writer Sub Agent:
- Implementation Sub Agent:
- Test / Verification Sub Agent:
- Review / Cutover Sub Agent:

## Spawned Sub Agents

| Agent | Scope | Output | Status |
| --- | --- | --- | --- |
| Architecture Explorer | | | |
| Legacy Behavior Explorer | | | |
| Dependency Explorer | | | |
| SPEC Writer | | | |
| Implementation | | | |
| Verification | | | |
| Cutover Review | | | |
```

如果一个 Capability 没有经过 Sub Agent 调查、没有 SPEC、没有 verification report，就不应该被视为完成。

---

## Acceptance Criteria

- Tsuki/Hono server 能够启动并处理请求
- 架构清晰，模块划分合理，相关开发工具和流程完善
- 每个核心 Capability 都有 SPEC、目标 Module、明确依赖、生命周期、测试和 cutover 记录
- 兼容层能够支持旧 renderer / IPC / socket 调用
- 迁移过程有充分测试保障
- 每个 Capability 都经过 Leader Agent 编排，有 Spawned Sub Agents 的调查记录
- 每个实现都必须能追溯到 Capability SPEC，而不是旧 Service 形状
- 请除了 test 外，请进行 type check 来验证类型安全