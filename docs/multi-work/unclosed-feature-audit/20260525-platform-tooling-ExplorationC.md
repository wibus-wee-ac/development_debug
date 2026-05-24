# Exploration Agent C：平台、工具链、插件、桌面端、CLI 与 e2e 未收口审计

## 审计范围

本次审计只覆盖非 `apps/web` / `apps/server` 主路径上的闭环风险，具体检查了：

- `apps/desktop/**`
- `packages/cli/**`
- `packages/ipc/**`
- `packages/plugin-sdk/**`
- `packages/tabs-next/**`
- `plugins/**`
- `e2e/**`
- `chronicle/**` 中与 Cradle 集成闭环相关的部分
- `docs/**` 与 `documentations/**` 中用户入口、规格、计划对上述能力的声明

本次没有修改业务代码，只新增本 handoff 文件。

## 方法

- 先阅读 `docs/exec-plans/20260525-01-unclosed-feature-audit.md`、`AGENTS.md`、`README.md`，采用“有入口或声明，但实现、打包、运行时、测试或所有权没有端到端闭合”的判据。
- 用 `find` 与 `rg` 建立范围索引，排除 `node_modules`、`dist`、`target` 和发行产物噪声后，重点核对 plugin manifest、desktop packaging、server plugin loader、web plugin host、CLI 生成链和 e2e feature/step。
- 对 Chronicle 只看 Rust core 与 Cradle Server 的集成边界，未深入审计 Chronicle 内部算法正确性。

## 发现

### P1：官方插件与 Marketplace 声称的 `@cradle/system-info` / `@cradle/cc-switch` 没有生产发行闭环

**证据文件：**

- `README.md:30-36` 将 `@cradle/browser-use`、`@cradle/cc-switch`、`@cradle/system-info` 都列为 Official Plugins。
- `documentations/lib/plugin-marketplace.ts:90-132` 把 `cc-switch` 和 `system-info` 放进 Marketplace entries，并生成 install link。
- `apps/desktop/electron-builder.yml:23-27` 只把 `../../plugins/browser-use` 打进 `extraResources`，没有打包 `plugins/cc-switch` 或 `plugins/system-info`。
- `apps/desktop/package.json:14` 的 desktop build 只执行 `pnpm --filter @cradle/browser-use build`，没有构建 `@cradle/cc-switch` 或 `@cradle/system-info`。
- `plugins/system-info/package.json:10-11` 声明 `server: "src/server.ts"`、`web: "dist/web.mjs"`；`plugins/system-info/vite.config.ts:8-20` 只构建 web bundle，没有构建 server bundle。
- `plugins/cc-switch/package.json:10` 声明 `server: "src/server.ts"`；但 `plugins/cc-switch/vite.config.ts:8-26` 实际会构建 `dist/server.mjs`，manifest 没有指向该 runnable entry。
- `apps/server/src/plugins/loader.ts:157-162` 直接 `import(entryPath)` 加载 `manifest.cradle.server`，没有转译 `.ts` 的生产兜底。
- `apps/desktop/src/main/server-process.ts:68-76` 只有 dev 模式给 server child process 加 `--import tsx`；生产模式运行 `server/main.js` 且 `execArgv` 为空。
- `apps/desktop/src/main/plugin-install-links.ts:302-320` 对 downloaded plugin 要求 runtime entries 是 `.mjs` / `.js` / `.cjs` 并且存在；`src/server.ts` 会被拒绝。

**为什么属于未收口：**

用户入口和文档把三个官方插件都呈现为可用能力，但桌面生产包只携带 `browser-use`。即使用户通过 Marketplace 安装 `cc-switch` 或 `system-info`，下载路径也会因为 manifest 指向 `src/server.ts` 被 installer 拒绝；如果在 dev workspace 中作为 already-available plugin 使用，又会跳过 runnable entry 校验，导致开发态与生产态语义不一致。`cc-switch` 还有更明显的漂移：构建产物是 `dist/server.mjs`，manifest 仍指向源码。

**建议验证方式：**

- 运行 `pnpm --filter @cradle/desktop build` 后检查 `apps/desktop/release/*/Resources/plugins`，确认只有 `browser-use`。
- 对 `cc-switch` 和 `system-info` 的 install link 走 downloaded path，预期看到 non-runnable `src/server.ts` entry 被拒绝。
- 在生产打包 app 中调用 `GET /api/plugins`，确认 `cc-switch` / `system-info` 不会作为 active official plugin 出现。

**剩余不确定性：**

- 本次没有实际运行 packaged app。结论基于 build script、builder config、loader import 逻辑和 manifest 的静态证据，置信度高。

### P1：`System Info` e2e 场景验证的是开发态插件宿主，不覆盖官方插件的打包与安装链路

**证据文件：**

- `e2e/src/features/plugins.feature:7-21` 定义了打开并刷新 `System Info` 插件面板的 P1 场景。
- `e2e/src/steps/plugins.steps.ts:7-24` 只等待 `[data-testid="plugin-panel-link-system-info"]` 并点击，未验证 plugin source、packaged resource、install receipt 或生产 runtime entry。
- `apps/web/src/lib/plugin-host.ts:234-248` renderer 只从 `GET /api/plugins` 读取 web plugins，再动态 import `/api/plugins/{routeSegment}/web.mjs`。
- `apps/web/src/features/plugins/plugins-sidebar.tsx:15-24` 只有当 web plugin 注册 panel 后才显示 sidebar，无法区分该 panel 来自 workspace dev source 还是 packaged resource。
- `apps/desktop/electron-builder.yml:23-27` 生产包不包含 `system-info`，因此当前 e2e 不能证明 README/Marketplace 中的官方插件在发行包可用。

**为什么属于未收口：**

测试名和 feature 描述给人的信号是“插件面板可用”，但它没有覆盖最容易断裂的产品路径：desktop packaged runtime 的 plugin discovery、resource packaging、server route activation 和 web bundle serving。结合上一条发现，当前 e2e 可能在 dev workspace 通过，却无法防止 `System Info` 从正式发行版消失。

**建议验证方式：**

- 增加 packaged desktop smoke：启动打包产物，调用 `GET /api/plugins`，断言 expected official plugin set 和每个 layer status。
- 对 `System Info` 追加来源断言：`PluginDescriptor.source.kind` 应在发行包中为 `bundledResource`，而不是只验证 sidebar DOM。
- 在 e2e artifacts 中保留 `/api/plugins` 响应，便于定位 plugin host 与 web host 的断裂点。

**剩余不确定性：**

- 未检查当前 e2e runner 是否有独立 packaged 模式；静态范围内没有看到此场景对 builder output 的断言。

### P2：Chronicle Rust core 与 Cradle Server/CLI 的职责边界仍容易让用户误判为已端到端集成

**证据文件：**

- `chronicle/src/integrations/README.md:3-5` 明确当前 `integrations/` 只有 Cradle Server URL helper，且 Server URL 只用于模型安装等外部能力定位，不代表 Server 拥有 Chronicle memory core 或 ingest semantics。
- `chronicle/src/integrations/cradle_server.rs:5-10` 只提供 `DEFAULT_CRADLE_URL` 和 `cradle_base_url()`。
- `chronicle/src/models.rs:129-147` 在模型缺失时请求 Server 安装模型。
- `chronicle/src/models.rs:160-176` 调用 `POST {CRADLE_URL}/chronicle/model-resources/{category}/install`。
- `packages/cli/src/commands/generated/chronicle/**` 暴露大量 `chronicle` CLI 命令，包括 memories、timeline、activity-segments、privacy、model-resources 等。
- `README.md:24` 把 Long-term Memory 作为产品 feature 呈现。

**为什么属于未收口：**

Rust Chronicle 文档强调 core path 不依赖 Server，当前 Cradle 集成只保留模型安装 helper；另一方面 CLI 与产品 README 已经暴露大量 Chronicle/Memory 入口。这里不一定是代码 bug，但产品表面容易暗示 Rust daemon、Server Chronicle routes、CLI projections 和 UI memory 能力已经形成统一闭环。按现有证据，Rust local store 到 Server/CLI 的投影边界仍需要非常明确，否则用户会把两个相邻但不同 owner 的 Chronicle 能力误认为同一条端到端路径。

**建议验证方式：**

- 启动 `cradle-chronicle --smoke` 写入本地 store 后，验证 `cradle chronicle memories list` 是否能看到同一份 memory；如果不能，文档和 CLI help 应明确 CLI 读的是 Server-owned projection，不是 Rust local store。
- 为 `chronicle` CLI 文档补一张 ownership matrix：Rust local state、Server DB、model resource install、UI/CLI query 各自的 owner 和同步方式。
- 对模型安装保留 focused test：当 `CRADLE_URL` 不可达时，local-only path 不应误写 Server namespace，也不应让 core capture/summary 失败。

**剩余不确定性：**

- 本次没有深入审计 `apps/server/src/modules/chronicle/**` 的数据模型，也没有运行 Rust daemon 与 CLI 的联动验证。因此该发现标为 P2，属于产品/工具链边界未充分闭合的风险，而不是确认的运行时失败。

### P3：桌面原生能力有较多单元测试，但缺少跨进程 smoke 覆盖

**证据文件：**

- `apps/desktop/src/preload/index.ts:54-72` 暴露 `desktopUpdate` 与 `desktopTray` renderer bridge。
- `apps/desktop/src/main/native-services.ts:185-234` 暴露 `desktopUpdate` IPC service。
- `apps/desktop/src/main/native-services.ts:238-306` 暴露 `macCapture` IPC service 和 permission/capture APIs。
- `apps/desktop/src/main/README.md:42-50` 描述 Desktop Updates 与 mac bridge 的用户可见 workflow。
- `apps/desktop/src/main/tray-manager.test.ts`、`apps/desktop/src/main/mac-bridge-manager.test.ts`、`apps/desktop/src/main/mac-screenshot-sinks.test.ts` 覆盖了 main process 单元行为。
- `e2e/src/features/**` 未看到 desktop update、mac capture、plugin install deep link 或 tray native menu 的端到端 feature。

**为什么属于未收口：**

这些能力已经有 preload 和 IPC 入口，也有 main-process 单测，但没有看到从 renderer 调用到 Electron main、再到 native/runtime side effect 的 smoke。对于更新、tray、mac capture 这种跨进程能力，单测容易覆盖 fake Electron 对象而漏掉 preload channel、window lifecycle、权限不可用状态和 packaged resource path。

**建议验证方式：**

- 增加 desktop smoke：renderer 调 `window.cradle.desktopUpdate.onStatusChanged` 与 service methods，断言 unsupported/feed-configured 状态可见。
- 增加 mac bridge smoke：在无权限或非 macOS 环境断言 `macCapture.getStatus()` 返回稳定 degraded state，而不是 renderer crash。
- 增加 tray action smoke：触发 `desktop-tray:perform-action` 后验证 main window 收到 `desktop-tray:action-requested` 或 pending queue 可消费。

**剩余不确定性：**

- 此项没有发现明确“入口完全无实现”的 P1 bug；风险主要是跨进程验收覆盖不足。

## 检查过但未发现高确信未收口的问题

- `packages/cli`：命令主体来自 server OpenAPI 的 `x-cradle-cli` metadata，`packages/cli/scripts/generate-cli.ts` 会直接创建 server app 并读取 `/openapi.json`；生成目录有 README 标注不要手改。未逐个验证所有 generated command 与服务端 handler 的语义一致性。
- `packages/ipc`：基础 decorator IPC、client invoke 和 event status 有单元测试；本次未发现明显 stub 或未实现入口。
- `packages/tabs-next`：存在 retained tabs、URL sync、cross-window sync、renderer policy 等测试；本次未发现平台侧未收口点。
- `plugins/browser-use`：manifest、desktop/server entries 和 desktop builder 打包路径相对一致；既有 exec plan 和代码都指向 plugin-owned runtime。仍建议保留 packaged smoke，因为其能力依赖 Electron webview、Unix socket、MCP server 和 provider runtime 的组合。

## 总体剩余风险

- 本次以静态审计为主，没有启动 dev server、e2e runner 或 packaged desktop app。
- `apps/server/src/modules/chronicle/**` 未被深入审计；Chronicle 相关结论只覆盖 Rust crate 与 Cradle 集成边界。
- 由于仓库已有发行产物和大量生成文件，本次搜索刻意排除了 `dist`、`target`、`node_modules` 和 release artifacts；如果某些能力只存在于旧产物中，不应视为当前源码闭环。
