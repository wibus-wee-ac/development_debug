# 20260606 Dirty Regressions Release Audit L

## 范围

审计目标：private release test readiness，聚焦 dirty worktree deletions/renames/regressions、removed feature fallout、`pack-codebase`、capsule composer、runtime toolbar、generated API/docs drift。

约束：未修改源码；只运行 `git status`、只读搜索、diff/typecheck 证据；仅写入本 handoff markdown。

## 结论

当前 dirty worktree 不适合进入 private release test。源码侧 `pack-codebase` 删除基本完整，CLI/web generated source 也已去掉 `workspace pack` 与 `/workspaces/{id}/pack`，但仍存在 5 类 release blocker：`server`/`web` typecheck 失败、capsule composer 替换后 E2E locator 未同步、ignored desktop release bundle 仍携带旧 pack-codebase 能力、用户 IPC 文档仍声明已删除 API、runtime session panel 删除了 subagent/call 状态可视化。

## Findings

### Critical - Server/Web typecheck 均失败，generated API drift 已变成编译 blocker

Evidence:

- `pnpm --filter @cradle/server exec tsc --noEmit` exit code `1`。
- 服务器错误集中在 [apps/server/src/modules/agent-identity/service.ts](/Users/wibus/dev/Cradle/apps/server/src/modules/agent-identity/service.ts:258)：insert `agents.thinkingEffort` 时，parsed input 仍可能是 `auto`，但 service/model 输入类型不接受 `auto`。
- `pnpm --filter @cradle/web exec tsc --noEmit` exit code `1`。
- Web 错误集中在 [apps/web/src/features/agent-management/agent-list.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-list.tsx:77)：UI 把 `auto` 放进 `AGENT_THINKING_EFFORTS`，但 `AgentBatchThinkingEffort` 不接受 `auto`。
- Contract split 证据：
  - [packages/db/src/schema/identity.ts](/Users/wibus/dev/Cradle/packages/db/src/schema/identity.ts:38) enum 当前包含 `auto`。
  - [apps/server/src/modules/agent-identity/service.ts](/Users/wibus/dev/Cradle/apps/server/src/modules/agent-identity/service.ts:39) 的 `CreateAgentInput.thinkingEffort` 不包含 `auto`。
  - `apps/web/src/api-gen/types.gen.ts` 中 generated agent response/request 已包含 `auto | none | minimal | low | medium | high | xhigh | max`。
- `pnpm --filter @cradle/cli typecheck` 通过，所以当前 blocker 不在 CLI TypeScript，而在 server/web API 语义收敛。

Impact:

Release gate 无法以 typecheck 通过作为准入。更重要的是，agent thinking effort 在 DB schema、server model/service、generated web API、Agent Management UI 之间语义不一致；private tester 的 agent import/settings/chat runtime 选择路径会直接踩到该 contract split。

Confidence: High.

### High - Capsule composer 删除后，workspace E2E 仍定位旧 test ids

Evidence:

- Dirty status 删除了 `apps/web/src/features/workspace-detail/capsule-composer.tsx`。
- [apps/web/src/features/workspace-detail/workspace-detail-page.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/workspace-detail/workspace-detail-page.tsx:894) 现在渲染 `DraftChatComposer`，并传入 `testIdPrefix="workspace-detail"`。
- 新 composer 根据 `testIdPrefix` 生成 `workspace-detail-textarea` 和 `workspace-detail-send-btn`。
- 但 [e2e/src/steps/workspace.steps.ts](/Users/wibus/dev/Cradle/e2e/src/steps/workspace.steps.ts:259) 仍查找 `workspace-detail-capsule-textarea`。
- [e2e/src/steps/workspace.steps.ts](/Users/wibus/dev/Cradle/e2e/src/steps/workspace.steps.ts:265) 仍查找 `workspace-detail-capsule-send-btn`。

Impact:

`CRADLE-WORKSPACE-008` 从 workspace detail 直接开始项目任务的 E2E 会在 locator 阶段失败。该路径正好覆盖 capsule composer 被替换后的首要用户行为，因此这是删除/替换 fallout，不是单纯测试陈旧。

Confidence: High.

### High - Ignored desktop release bundle 仍包含旧 pack-codebase route、CLI command 和 MCP tool

Evidence:

- `.gitignore` 忽略 `apps/desktop/release`，见 [.gitignore](/Users/wibus/dev/Cradle/.gitignore:16)。
- `git ls-files apps/desktop/release` 无 tracked 文件，说明这些是本地 ignored release artifacts。
- 但搜索当前 ignored bundle 命中旧能力：
  - `apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/cli/index.js` 仍有 `src/commands/generated/workspace/pack.ts` 和 `/workspaces/{id}/pack`。
  - `apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app/Contents/Resources/server/assets/app-DpDKGI7j.js` 仍注册 `PackCodebaseModel`、`packCodebase` 和 `app.use(packCodebase)`。
  - `apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app/Contents/Resources/server/assets/mcpAction-DmAclM20.js` 仍注册 `packCodebase` MCP tool。
- 当前 source composition root [apps/server/src/app.ts](/Users/wibus/dev/Cradle/apps/server/src/app.ts:118) 已不再 import/use `packCodebase`，所以这是 release artifact stale，不是源码引用残留。
- `electron-builder` 输出目录是 `release`，见 [apps/desktop/electron-builder.mjs](/Users/wibus/dev/Cradle/apps/desktop/electron-builder.mjs:100)。

Impact:

如果 private release tester 拿到的是当前 `apps/desktop/release` 下的本地包，包内仍暴露已删除的 pack-codebase HTTP/CLI/MCP surface，和源码/文档变更相冲突。若发布流程一定先跑 [apps/desktop/package.json](/Users/wibus/dev/Cradle/apps/desktop/package.json:20) 的 `dist` 重新构建，这个风险降为 stale artifact cleanup；但当前工作区证据不能证明将分发的包已经重建。

Confidence: High for local artifact staleness; Medium for actual distribution impact because release pipeline choice未在本审计中验证。

### Medium - pack-codebase 用户 IPC 文档仍声明已删除 API

Evidence:

- 源码范围搜索排除 `apps/desktop/release/**` 后，当前 active source/generated docs 中 pack-codebase 残留只剩 [docs/for-users/ipc-api-reference.md](/Users/wibus/dev/Cradle/docs/for-users/ipc-api-reference.md:214)。
- 该文档仍声明 `packCodebase` 和 `pack(...)`，见 [docs/for-users/ipc-api-reference.md](/Users/wibus/dev/Cradle/docs/for-users/ipc-api-reference.md:216)。
- 同时以下 source paths 已删除：
  - `apps/server/src/modules/pack-codebase/*`
  - `apps/web/src/features/pack-codebase/*`
  - `packages/cli/src/commands/generated/workspace/pack.ts`
  - `documentations/content/docs/workspace/pack-codebase.mdx`
  - `apps/web/src/locales/*/pack-codebase.*`

Impact:

Private release docs 会向用户/插件作者/IPC consumers 承诺一个不存在的 IPC capability。对于“removed feature fallout”来说，这是高可见文档漂移；即使 pack-codebase 删除是 intentional breaking change，也需要从 user-facing API reference 中同步移除或标注 retired。

Confidence: High.

### Medium - pack-codebase E2E journeys 被删除，未看到替代 coverage 或 removal note

Evidence:

- `e2e/src/features/workspace.feature` 删除了 `CRADLE-WORKSPACE-007` 两个 P1 场景：复制代码库到剪贴板、通过 ignore 规则排除文件。
- `e2e/src/steps/workspace.steps.ts` 删除了 pack dialog、scope、ignore、submit、clipboard assertion 对应 step definitions。
- 搜索 active E2E/source 后，未发现新的 pack-codebase journey 或 successor capability coverage。

Impact:

如果 pack-codebase 只是暂时下线，release suite 已经失去唯一覆盖 workspace context packing 的用户旅程。如果这是永久删除，则需要 release notes/docs 明确 removal，避免 private testers 按旧 preview docs 或历史 journeys 寻找该能力。

Confidence: Medium。删除可能是 intentional，但缺少 release-facing removal trail。

### Medium - Runtime session panel 删除了 subagent/call 状态视图，runtime toolbar fallout 没有测试证据覆盖

Evidence:

- `apps/web/src/features/chat/runtime-toolbar-options.tsx` 已删除，active source 无 direct import 残留。
- [apps/web/src/features/chat/runtime-session-panel.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/runtime-session-panel.tsx:279) 的 `SubagentsPanel` 现在只在 `agents.length > 0` 时渲染；空状态和 loading state 被移除。
- 同一 diff 删除了 `Active/Done/Failed` compact metrics、recent crew calls、call status/target/prompt rows、agent status/details/description 文案。
- 当前渲染只展示最多 6 个 agent button 和 identicon，见 [apps/web/src/features/chat/runtime-session-panel.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/runtime-session-panel.tsx:301)。

Impact:

Private tester 在 runtime toolbar/session panel 中将看不到 subagent 加载中、无活动、失败数、已完成数、recent call status/targets/prompt。对于本轮重点的 runtime toolbar readiness，这会降低诊断能力，尤其是多 agent/side conversation 失败时。未看到对应 UI test/E2E 来证明这是有意产品降级且不会影响 tester triage。

Confidence: Medium。源码 diff 明确；产品意图未验证。

## Passed/Non-Issues Observed

- Active source search 未发现 `runtime-toolbar-options`、`capsule-composer`、`pack-codebase` 的 direct import 残留。
- `packages/cli/src/commands/generated/index.generated.ts` 已移除 `registerWorkspacePack`，并新增 runtime settings / desktop preferences generated commands。
- `apps/web/src/api-gen/sdk.gen.ts` 已移除 `postWorkspacesByIdPack`。
- `apps/server/src/app.ts` 已移除 `packCodebase` module registration。
- `pnpm --filter @cradle/cli typecheck` 通过。

## Commands Run

```bash
git status --short
git diff --name-status
git diff --stat
rg -n "pack-codebase|packCodebase|PackCodebase|workspace pack|workspace/pack|/workspaces/.*/pack" .
rg -n "capsule-composer|CapsuleComposer|capsuleComposer" apps documentations docs packages e2e
rg -n "runtime-toolbar-options|RuntimeToolbar|toolbar options|toolbarOptions" apps/web apps/server packages/cli documentations docs
rg -n --glob '!apps/desktop/release/**' "pack-codebase|packCodebase|PackCodebase|workspace pack|workspace/pack|/workspaces/.*/pack" apps packages documentations e2e docs/for-users package.json pnpm-lock.yaml
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/cli typecheck
git ls-files apps/desktop/release
git check-ignore -v apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/cli/index.js apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app/Contents/Resources/server/assets/app-DpDKGI7j.js apps/desktop/release
```

## Release Recommendation

不要进入 private release test。最低修复/确认门槛：

1. 先统一 `thinkingEffort` contract，并让 server/web typecheck 通过。
2. 同步 workspace detail composer E2E locators，或保留兼容 test ids，确保 capsule composer replacement 的主旅程可跑。
3. 重新生成并验证 desktop release artifact，确认分发包不再包含 pack-codebase route/CLI/MCP tool。
4. 从 user-facing IPC docs 移除或标注 retired `packCodebase`。
5. 对 runtime session panel 的 subagent/call 状态降级给出产品确认或恢复 diagnostic surface，并补一个 focused regression check。
