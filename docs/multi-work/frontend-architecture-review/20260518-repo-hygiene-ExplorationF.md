# Repository Hygiene Review - ExplorationF

## Scope

本 handoff 聚焦 frontend review scope 的仓库卫生与可维护性流程。检查范围包括 `apps/web`、`packages/tabs-next`、根级 package scripts、README/header 约定、生成代码与构建产物可见性、测试入口、当前 working tree 状态，以及与前端维护直接相关的文档约定。

本次只读审查基于 2026-05-18 当前 working tree；未修改业务代码。

## Files Inspected

- `AGENTS.md`
- `docs/exec-plans/20260518-05-frontend-architecture-review.md`
- `package.json`
- `apps/web/package.json`
- `packages/tabs-next/package.json`
- `.gitignore`
- `apps/web/.gitignore`
- `eslint.config.js`
- `vitest.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/openapi-ts.config.ts`
- `apps/web/vite.config.ts`
- `apps/web/src/features/README.md`
- `apps/web/src/features/chat/README.md`
- `apps/web/src/tabs/README.md`
- `packages/tabs-next/README.md`
- `apps/web/src/features/chat/blocks/*`
- 当前 working tree: `git status --short`、`git status --short --ignored`

## Findings

### High - `apps/web/src/api-gen` 被忽略且未被追踪，但前端源码依赖它

证据：

- `apps/web/.gitignore:3` 忽略 `src/api-gen/`。
- `git status --short --ignored -- apps/web/src/api-gen` 显示 `!! apps/web/src/api-gen/`。
- `git ls-files apps/web/src/api-gen` 返回 `0` 个 tracked 文件。
- 前端源码使用 `~/api-gen/sdk.gen`，例如当前改动中的 `apps/web/src/features/new-chat/new-chat-page.tsx`。
- `apps/web/openapi-ts.config.ts:4-8` 需要本地 server 暴露 `http://localhost:21423/openapi.json`，并设置 `output.clean: true`。
- `apps/web/tsconfig.json:25` 排除了 `src/api-gen/**`。

影响：

如果 fresh clone 或 CI 没有先运行生成流程，`apps/web` 会缺少编译所需模块。即使本地有生成文件，TypeScript 配置也不会直接检查生成输出本身，生成器或 OpenAPI schema 变更造成的类型破坏可能延迟到 import 使用点才暴露。

### Medium - `apps/web` 和 `packages/tabs-next` 缺少 package-local test/lint 脚本入口

证据：

- `apps/web/package.json:6-12` 只有 `dev`、`build`、`preview`、`typecheck`、`generate`。
- `packages/tabs-next/package.json:1-22` 没有 `scripts`。
- 根级 `package.json:17` 提供 `vitest run`，`vitest.config.ts` 覆盖 `src/**/*.test.*` 与 `packages/**/*.test.*`。
- 实际存在前端测试：`apps/web/src/features/chat/*.test.*`、`apps/web/src/store/*.test.ts`、`apps/web/src/tabs/*.test.*`、`packages/tabs-next/src/__tests__/*.test.*`。

影响：

前端 reviewer 或 CI job 难以用 ownership 边界运行最小验证。`@cradle/web` 可以 typecheck/build，却不能以相同 filter 语义运行自身测试；`@cradle/tabs-next` 有测试但 package manifest 没有声明 test/typecheck 入口。

### Medium - 新增 `apps/web/src/features/chat/blocks/` 目录没有目录级 README 记录

证据：

- 当前 untracked: `?? apps/web/src/features/chat/blocks/`。
- `AGENTS.md` 要求目录变更时更新 `README.md`，并强调文件 header 与目录 inventory。
- `apps/web/src/features/chat/README.md:11-25` 仍列出旧的 top-level `reasoning-block.tsx`、`tool-call-block.tsx`，没有列出 `blocks/` 子目录、`edit-file-block.tsx`、`read-files-block.tsx` 等新 ownership。
- 新增 block 文件本身有 `Input / Output / Position` header，这部分符合文件级约定。

影响：

`chat` 渲染层正在被拆分成 block 子域，但 README 没有记录新边界。后续维护者很难判断旧 top-level block 文件与新 `blocks/` 实现之间的迁移状态、公共入口和测试期望。

### Medium - 当前前端改动没有相邻新增测试覆盖新的 block rendering 行为

证据：

- 当前前端改动包含 `apps/web/src/features/chat/message-bubble.tsx`、`tool-call-block.tsx`、`reasoning-block.tsx` 和新增 `apps/web/src/features/chat/blocks/*`。
- 现有测试集中在 streaming/session/store/tab：`chat-streaming-handler.test.ts`、`use-chat-session*.test.*`、`store/*.test.ts`、`tabs/*.test.*`。
- 未发现 `message-bubble` 或 `chat/blocks` 的 render regression test。

影响：

这类 UI 拆分涉及 tool part state、reasoning 展开折叠、file diff/read rendering 和 subagent folds。没有相邻测试时，后续重构容易破坏关键状态映射或 E2E anchors，问题会转移到人工检查阶段。

### Low - `pnpm-lock.yaml` 出现非显式依赖升级噪声

证据：

- `apps/web/package.json` 只新增 `diff` 与 `@types/diff`。
- `pnpm-lock.yaml` 同时把 `react-grab` 从 `0.1.36` 更新到 `0.1.37`，并更新 `@react-grab/cli`。
- `@types/diff@8.0.0` 在 lockfile 中标记为 deprecated stub，因为 `diff` 自带类型。

影响：

lockfile 噪声会扩大 review surface，并可能引入与当前 feature 无关的 frontend tooling 变化。`@types/diff` 也可能是不必要依赖。

### Low - 文档语言与 inventory 风格不一致

证据：

- `apps/web/src/tabs/README.md:13-14` 的条目说明混入中文，周围条目是英文。
- `apps/web/src/features/chat/README.md:22` 混入中文标点与中文说明。

影响：

这不是功能风险，但会降低 README 作为快速 inventory 的扫描一致性。考虑到项目层面要求解释可用简体中文、代码标识符英文，这里更像局部风格不一致，而非硬性违规。

## Recommended Changes

1. 明确 `apps/web/src/api-gen` 的 ownership 策略：
   - 如果生成代码不提交：在 CI/bootstrap 中强制运行 `pnpm generate:web`，并把 `apps/web` 的 typecheck/build 依赖改成先生成；同时提供无本地 server 的 schema 输入方式。
   - 如果生成代码提交：移除 `apps/web/.gitignore` 中的 `src/api-gen/`，并把 `openapi-ts` 生成结果纳入 review。
   - 不建议保持当前“源码依赖生成文件，但生成文件既忽略又没有标准 bootstrap”的中间状态。
2. 为 frontend ownership 增加 package-local scripts：
   - `apps/web`: 建议添加 `test`，例如 `vitest run apps/web/src` 或通过 root Vitest include 精准过滤。
   - `packages/tabs-next`: 建议添加 `test` 和 `typecheck`，让 tab package 可以独立验证。
   - 根级脚本继续保留 aggregate job，但 reviewer 应有局部入口。
3. 更新 `apps/web/src/features/chat/README.md`：
   - 增加 `blocks/` 子目录 inventory。
   - 标明 top-level `reasoning-block.tsx`、`tool-call-block.tsx` 与 `blocks/*` 的迁移关系。
   - 记录 `message-bubble.tsx` 依赖 `blocks/index.ts` 作为 block registry/barrel。
4. 为新的 chat block rendering 添加最小 render regression tests：
   - `message-bubble` 对 `tool-*` part 的状态映射。
   - `EditFileBlock` 的 diff line rendering。
   - `ReadFilesBlock` 的折叠/展开数量逻辑。
   - `ReasoningBlock` streaming/done 展示与 stable anchors。
5. 清理 lockfile 与依赖噪声：
   - 确认 `react-grab` 升级是否有意。
   - 移除 `@types/diff`，除非实际类型解析需要它。
6. 统一 README inventory 风格：
   - 对目录 inventory 使用一致语言和标点。
   - 对代码标识符、路径、文件名保持 English。

## Risks

- `api-gen` 策略调整会影响 onboarding、CI 和 server/frontend schema ownership；需要先决定 API client 是 committed artifact 还是 generated local artifact。
- 给 `apps/web` 添加局部 test script 时要小心 Vitest root 配置的 alias 和 environment。当前 root config 的 `environment: node` 可能不适合所有 React render tests，必要时需要为 `jsdom` 测试显式配置。
- `chat/blocks` 测试如果过度绑定 DOM 细节，会增加重构成本；建议只锁定状态映射、关键文本、stable anchors 和展开行为。
- lockfile 清理应通过 package manager 正常安装流程完成，避免手写 lockfile。

## Validation

建议在修复上述 hygiene 问题后运行：

```bash
git status --short --ignored -- apps/web/src/api-gen apps/web/openapi-ts-error-1778658727722.log packages/tabs-next/tsconfig.tsbuildinfo
pnpm generate:web
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/web build
pnpm vitest run apps/web/src/features/chat apps/web/src/store apps/web/src/tabs packages/tabs-next/src
pnpm lint
pnpm knip
```

如果新增 package-local scripts，则建议验证：

```bash
pnpm --filter @cradle/web test
pnpm --filter @cradle/tabs-next test
pnpm --filter @cradle/tabs-next typecheck
```

## Uncertainties

- 尚不确定团队是否有意把 `apps/web/src/api-gen` 作为本地生成、不提交的 artifact。当前证据只表明它被忽略、未追踪且被源码依赖。
- 未运行测试或 build；本 handoff 是仓库卫生审查，不是修复验证报告。
- 当前 working tree 已有其他 agent 或用户改动，包括前端与 server pty 模块；本报告只评价与 frontend maintainability 直接相关的部分。
- `openapi-ts-error-1778658727722.log` 被根 `.gitignore` 忽略，说明不会污染 git status，但它提示最近可能有生成失败；未读取该日志内容以避免扩大审查范围。
