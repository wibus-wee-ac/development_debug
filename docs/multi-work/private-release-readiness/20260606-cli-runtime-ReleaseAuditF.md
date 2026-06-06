# CLI Runtime Release Audit F

审计范围：generated CLI、Cradle CLI behavior、server locator、command registration、generated API drift。

审计限制：只读检查源码和命令输出；未修改源码；只写入本 handoff 文件。

## 结论

当前 CLI 基础启动路径可用，`@cradle/cli` typecheck 通过，source/dist/root script 的 help 都能显示。当前 server OpenAPI 与 checked-in generated command snapshot 在集合层面没有 drift：OpenAPI 暴露 206 条 CLI operation，generated snapshot 也是 206 条，missing/stale/duplicate 都为 0。

私测前仍有 2 个高优先级问题需要处理：一是 generated CLI refresh 在干净环境缺少 DB env 时会失败；二是 root `bin` 依赖 ignored 的 `packages/cli/dist/index.js`，源码分发或 fresh checkout 场景容易拿到坏的 `cradle` 入口。另有若干中等风险集中在 generated command 可用性和 discoverability。

## Findings

### High - `pnpm gen:cli` 在干净环境需要 DB 配置，API drift 检查不能开箱运行

**Evidence**

- `packages/cli/scripts/generate-cli.ts:5` 直接 import server app；`packages/cli/scripts/generate-cli.ts:228-235` 通过 `createServerApp({ startBackgroundTasks: false })` 请求 `/openapi.json`。
- `apps/server/src/app.ts:74-81` 创建 app 时调用 `recoverPersistedRunProjections()`，这会触发 server infra/DB 初始化路径。
- `apps/server/src/config/server-config.ts:23-26` 在没有 `CRADLE_DATA_DIR` 或 `CRADLE_DB_PATH` 时直接抛错。
- 实测只读 OpenAPI 对比脚本在未设置 DB env 时失败：`Error: CRADLE_DATA_DIR or CRADLE_DB_PATH is required`。
- 设置临时 `CRADLE_DATA_DIR="$(mktemp -d)"` 后，同一对比路径成功完成。

**Impact**

私测用户或 release checker 从 clean shell 执行 `pnpm gen:cli`、generated API drift 检查或任何依赖 in-process OpenAPI 的 CLI 生成流程，会在没有显式数据目录配置时失败。这个问题不影响已生成 CLI 的 `--help`，但会阻断“当前 server API 是否已经同步到 generated CLI”的验证流程。

**Confidence**

High。命令失败可复现，源码路径清晰，设置临时 `CRADLE_DATA_DIR` 后同路径通过，说明失败点不是 OpenAPI/schema 本身。

### High - root `bin` 指向 ignored build artifact，fresh source install/link 容易得到坏入口

**Evidence**

- 根 `package.json:7-9` 声明 `"cradle": "./packages/cli/dist/index.js"`。
- `.gitignore:1-2` 忽略 `dist`，`git ls-files packages/cli/dist` 没有返回 tracked 文件。
- `packages/cli/package.json:6-16` 的 package 级 `bin` 也依赖 `dist/index.js`，但 package 自身通过 `"files": ["dist"]` 控制 npm package 内容。
- `packages/cli` 的 `npm pack --dry-run --json` 显示 package tarball 会包含 `dist/index.js` 和 `dist/index.js.map`，这只证明 package 内部发布在本机已 build 时可用；根包 source/fresh checkout 场景仍依赖一个 ignored artifact。
- 根 scripts 只有 `cli` 和 `gen:cli`，没有 root-level `build:cli` 或 prepare/prepack 保障 root `bin` 目标存在。

**Impact**

如果私测分发方式是源码包、Git checkout 后 `npm link`/`pnpm link` root，或者任何没有先跑 `pnpm --filter @cradle/cli build` 的路径，`cradle` 二进制会指向不存在的 `packages/cli/dist/index.js`。这会造成 tester 的第一条 `cradle --help` 直接失败。若私测只分发 `@cradle/cli` tarball 且 release pipeline 明确先 build CLI，则该风险下降。

**Confidence**

High。路径、ignore 规则和 `git ls-files` 结果一致；CLI package dry-run 也确认了 dist 是 package artifact 而不是 source artifact。

### Medium - required boolean flags 的 CLI 形态不符合 tester 直觉，确认类写入命令容易误用

**Evidence**

- `packages/cli/src/runtime/operation-command.ts:168-174` 对 required boolean flag 生成 `--name <value>`，而 optional boolean 才生成 bare `--name`/`--no-name`。
- `packages/cli/src/commands/generated/workspace/file/write.ts:33-38` 将 `confirmedNonCradleOwnedWrite` 标记为 required boolean。
- `cradle workspace file write --help` 显示 `--confirmed-non-cradle-owned-write <value>`，没有 allowed values 或 confirmation 说明。
- 实测 `--confirmed-non-cradle-owned-write` 不带值会被 Commander 拒绝：`error: option '--confirmed-non-cradle-owned-write <value>' argument missing`。
- 带 `true` 后才进入 HTTP 请求路径。

**Impact**

workspace file write/create/rename/folder create 和 skill export 这类确认型命令会让 tester 误以为传 flag 即表示确认。实际必须传 `true`/`false` 字符串，且 help 中没有说明只有 `true` 才能通过 server-side non-Cradle-owned write guard。私测中这会表现为“CLI 参数很怪”或“写文件命令不可用”，尤其影响 agent-facing shell usage。

**Confidence**

High。help 和 Commander 错误可复现，生成规则明确。

### Medium - session await 同时存在扁平 generated 命令和手写嵌套命令，discoverability 混乱

**Evidence**

- `packages/cli/src/index.ts:15-17` 先注册 generated commands，再注册手写 `session await`，最后注册 `man`。
- generated await 命令位于 `session await-create`、`session await-get`、`session await-list` 等，例如 `packages/cli/src/commands/generated/session/await-create.ts:7-57`。
- 手写命令位于 `session await github-ci/github-review/manual/retry`，见 `packages/cli/src/commands/session-await.ts:138-242`。
- `cradle session --help` 同时显示 `await-create`、`await-get`、`await-list` 和一个 `await` 子树。
- `cradle session await --help` 只显示手写 helper，不显示 generated CRUD/list/get/cancel/trigger/summary。

**Impact**

私测用户很难判断 await 的主入口是 `session await-create` 还是 `session await manual`。同一领域被拆成扁平 generated API 和 curated subcommand，增加文档、support 和 command discovery 成本。它不直接阻断功能，但会影响 session pause/resume await 的测试覆盖质量。

**Confidence**

High。help 输出和 registration 顺序都已确认。

### Medium - 同一路径既是 leaf command 又是 command group，help 形态不稳定

**Evidence**

- OpenAPI/generated command 集合检查发现 2 个 leaf+group path：`automation run` 和 `chat queue`。
- `cradle automation run --help` 显示 `Usage: cradle automation run [options] [command] <id>`，同时它自己是 “Run automation now”，又挂载 `get` 子命令。
- `cradle chat queue --help` 显示 `Usage: cradle chat queue [options] [command] <sessionId>`，同时它自己是 list queue，又挂载 `add/cancel/reorder`。
- 生成 runtime 在 `packages/cli/src/runtime/operation-command.ts:112-123` 复用已有 group，在 `packages/cli/src/runtime/operation-command.ts:153-225` 又向 parent 添加 leaf，因此这类 shape 是 generator 允许的。

**Impact**

Commander 支持这种形态，但对 tester 和文档生成不友好：同一 token 既是动作又是 namespace，help usage 包含 `[command] <id>`，很容易让用户误以为必须带子命令或把参数放错位置。它也会让未来 `cradle man` 输出变得更噪。

**Confidence**

Medium。当前 help 能显示，未证明执行路径失败；风险主要是 release test usability 和 command taxonomy。

## Passed Checks

- `pnpm --filter @cradle/cli typecheck` 通过。
- `pnpm --filter @cradle/cli cradle --help` 通过。
- `node packages/cli/dist/index.js --help` 通过。
- `pnpm cli --help` 通过。
- `cradle workspace git --help` 和 `cradle issue --help` 可显示代表性 nested command。
- `packages/cli` package dry-run 显示 package tarball 包含 `dist/index.js`，前提是本地已有 build artifact。
- 设置临时 `CRADLE_DATA_DIR` 后，当前 OpenAPI/generated 集合对比结果：
  - `openapiCount: 206`
  - `generatedCount: 206`
  - `missingCount: 0`
  - `staleCount: 0`
  - `duplicateCommandCount: 0`
  - `leafGroupCount: 2`

## Commands Run

```bash
pnpm --filter @cradle/cli typecheck
pnpm --filter @cradle/cli cradle --help
node packages/cli/dist/index.js --help
pnpm cli --help
pnpm --filter @cradle/cli cradle session --help
pnpm --filter @cradle/cli cradle session await --help
pnpm --filter @cradle/cli cradle workspace git --help
pnpm --filter @cradle/cli cradle issue --help
pnpm --filter @cradle/cli cradle workspace file write --help
pnpm --filter @cradle/cli cradle workspace file write test-id --path notes.md --content hi --confirmed-non-cradle-owned-write --server http://127.0.0.1:1
pnpm --filter @cradle/cli cradle workspace file write test-id --path notes.md --content hi --confirmed-non-cradle-owned-write true --server http://127.0.0.1:1
npm pack --dry-run --json
git status --short
git ls-files packages/cli/dist package.json packages/cli/package.json packages/cli/src/runtime/server-locator.ts packages/cli/vite.config.ts
git check-ignore -v packages/cli/dist/index.js packages/cli/dist/index.js.map packages/cli/dist
```

Notes:

- `npm pack --dry-run --json` was completed inside `packages/cli`.
- A root-level `npm pack --dry-run --json` probe did not finish within the audit window and was not used as release evidence.
- The OpenAPI/generated drift comparison used a one-off read-only `tsx` script. It failed without DB env, then passed with temporary `CRADLE_DATA_DIR`.

## Release Readiness Recommendation

Do not treat generated CLI/API drift as a blocker in the current snapshot; the checked-in generated command set matches current in-process OpenAPI when the server app can initialize.

Do treat the generator DB env dependency and root `bin` packaging path as private-release blockers unless the release instructions explicitly constrain testers to a prebuilt `@cradle/cli` tarball and never ask them to regenerate or drift-check CLI commands.
