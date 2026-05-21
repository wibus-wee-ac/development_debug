# Desktop/Rust/plugins helper anti-pattern scan

## Scope

本报告覆盖当前工作树中的这些表面：

- `apps/desktop/**`
- `chronicle/**`，排除 `chronicle/target/**` 构建产物
- `plugins/**`
- `resources/skills/**`
- 与这些表面交互的 cross-process helper：`packages/ipc/**`、`packages/plugin-sdk/**`、`apps/web/src/lib/electron.ts`、`apps/web/src/features/browser/**`、`apps/server/src/plugins/**`、`apps/server/src/modules/chronicle/**`、`apps/server/src/modules/skills/**`

这是 scan-only handoff。除本报告文件外，没有修改业务代码。当前仓库已有大量未提交改动；以下判断基于本次检查时的工作树状态。

## Severity Scale

- **High**：边界、生命周期或所有权问题可能导致能力越权、数据泄漏、生产功能静默失效，或会明显阻碍后续演进。
- **Medium**：明确的 DRY/SOLID、配置漂移、进程管理或维护性问题，当前未必立即触发严重故障，但会持续扩散风险。
- **Low**：局部 helper 或配置 smell，推荐修复但不应阻塞当前功能线。

## Findings

### 1. High — preload 暴露任意 IPC channel，renderer 能绕过 typed API 边界

**证据**

- `apps/desktop/src/preload/index.ts:21-30` 将 `ipc.invoke(channel: string, ...args)` 和 `ipc.on(channel: string, handler)` 原样暴露到 `window.cradle`。
- `apps/web/src/lib/electron.ts:131-133` 只在 TypeScript 层用 `createIpcProxy<CradleIpcServices>()` 限定调用形状；运行时仍拿到的是 raw `window.cradle.ipc`。
- `packages/ipc/src/client.ts:32-40` 的 proxy 可以为任意 `groupName.methodName` 生成 channel。
- `packages/ipc/src/base.ts:135-139` 注册 handler 时没有 channel allowlist 之外的 sender/origin 检查。
- 当前主进程已经注册了高权限 IPC 方法：文件对话和系统 shell 在 `apps/desktop/src/main/native-services.ts:16-57`，窗口控制在 `apps/desktop/src/main/native-services.ts:81-139`，更新检查/下载/应用在 `apps/desktop/src/main/native-services.ts:147-168`。

**为什么重要**

`contextIsolation` 只能隔离 Node 能力，不能限制 preload 主动暴露的能力。只要 renderer、web plugin、或页面内注入脚本拿到 `window.cradle.ipc`，就可以猜测并调用任意已注册 channel，而不是只能走 `nativeIpc` 中声明的 typed surface。这会把主进程方法注册表变成公开 ABI，并使后续新增 IPC 方法默认暴露给所有 renderer 代码。

**推荐修复方向**

- 从 preload 中移除 raw `ipc` 暴露，改为显式导出 narrow methods，例如 `native.showOpenDialog`、`window.minimize`、`desktopUpdate.getStatus`。
- 如果必须保留 proxy 模型，preload 层需要 runtime allowlist，事件订阅也要只允许已知 push event，例如 `desktop-update:status-changed`。
- `packages/ipc/src/base.ts` 可以增加 sender policy hook，由 desktop composition root 注入允许的 `WebContents` 或 URL predicate，避免 future service 默认被所有 renderer 调用。
- 对每个 IPC 方法增加 schema validation；当前 TypeScript signature 不能约束运行时 payload。

**验证**

- 新增 IPC 单元测试：未知 channel 的 `window.cradle` 调用被拒绝，已知 channel 仍可调用。
- Electron smoke/e2e：主窗口可打开目录、窗口控制、update status subscription 仍工作；直接调用不存在或未公开 channel 返回明确错误。
- 静态检查：`rg "window\\.cradle\\.ipc|cradle\\.ipc"` 只允许在受控桥接模块内出现。

---

### 2. High — Chronicle daemon 的 server URL ownership 漂移，desktop 动态端口会让 Rust 回写静默失败

**证据**

- `apps/desktop/src/main/server-process.ts:30-37` 用 `getPort()` 在 `21423..21426` 中选择实际 server 端口，并将 `currentServerUrl` 设为动态 URL。
- `apps/desktop/src/main/server-process.ts:59-68` fork server 时只注入 `CRADLE_HOST`、`CRADLE_PORT`、`CRADLE_DATA_DIR`、`CRADLE_CREDENTIAL_SECRET` 等，没有注入 `CRADLE_URL`。
- `apps/server/src/modules/chronicle/daemon-manager.ts:61-64` spawn `cradle-chronicle` 时没有显式传入 `env`，所以 Rust 子进程只能继承 server 进程环境。
- `chronicle/src/cradle_client.rs:16` 默认 URL 是 `http://127.0.0.1:21423`，`chronicle/src/cradle_client.rs:128-131` 只读取 `CRADLE_URL`。
- Rust 侧上报失败是非 fatal：`chronicle/src/daemon.rs:292-304` 只打印错误并保留本地 artifacts。

**为什么重要**

只要 `21423` 被占用，desktop server 会正常启动到 `21424+`，但 Chronicle daemon 仍会尝试把 snapshot/memory/summarize 请求发到 `21423`。由于上报失败被设计成非 fatal，用户看到的是本地捕获继续运行，但 server 数据、UI ingestion 或 LLM summary 可能静默缺失。这是典型 cross-process config owner 不清晰：desktop 知道真实 URL，server daemon manager 启动 Rust，Rust client 又只认 `CRADLE_URL`。

**推荐修复方向**

- 让 desktop 在 `startServer()` fork env 中注入 `CRADLE_URL: currentServerUrl`，这是最小修复。
- 更稳的长期方向：server 应拥有自己的 public base URL 配置，并在 `daemon-manager.ts` spawn Rust 时显式传入 `CRADLE_URL`，不要让 Rust 猜默认端口。
- `CradleClient::from_env()` 可以同时支持 `CRADLE_URL` 与 `CRADLE_HOST`/`CRADLE_PORT` fallback，但 owner 仍应在 process boundary 明确传值。

**验证**

- 桌面集成测试或手工验证：先占用 `21423`，启动 desktop，确认 server 在 `21424`，再启用 Chronicle；Rust 请求应命中实际端口。
- 单元测试：`startServer()` env 构造包含 `CRADLE_URL`；`daemon-manager.ts` spawn env 覆盖继承值。
- Rust 测试：`CradleClient::from_env()` 在设置 `CRADLE_URL` 时使用该值。

---

### 3. High — desktop plugin shared config 是全局 env bus，缺少 owner namespace

**证据**

- `apps/desktop/src/main/plugin-loader.ts:7-8` 用单个 `Map<string, string>` 保存所有 plugin shared config。
- `apps/desktop/src/main/plugin-loader.ts:47-53` 将所有 key 投影成 `CRADLE_PLUGIN_<SANITIZED_KEY>`，没有 owner 维度。
- `apps/desktop/src/main/plugin-loader.ts:226-249` 的 `setSharedConfig(key, value)` 接收任意 key，写入全局 map；capability record 有 owner，但实际数据没有 owner 隔离。
- `apps/server/src/plugins/context.ts:22-28` 为每个 server plugin 读取全部 `CRADLE_PLUGIN_*` 到同一个 `sharedConfig`。
- `packages/plugin-sdk/src/desktop.ts:22-23` 和 `packages/plugin-sdk/src/server.ts:23-24` 的 public API 也把 shared config 描述成全局 key/value。
- `plugins/browser-use/src/server.ts:8-18` 依赖 `BROWSER_BACKEND_SOCKET` 读取 desktop plugin 写入的 socket path。

**为什么重要**

任何 desktop plugin 都可以覆盖其他 plugin 的 key，例如写入 `BROWSER_BACKEND_SOCKET` 改变 browser-use server plugin 连接目标。所有 server plugin 也能读取所有 shared config，包含未来可能被插件误放进去的 secret 或 path。这个设计违反 repo 的 namespace ownership 原则：plugin 的跨层配置应该属于 plugin owner，而不是属于全局 `CRADLE_PLUGIN_*` 键空间。

**推荐修复方向**

- 将 desktop 侧数据结构改为 owner-scoped：`Map<pluginName, Map<key, value>>`。
- env 投影使用 owner namespace，例如 `CRADLE_PLUGIN_CONFIG_<ownerRouteSegment>_<key>`，server context 只暴露当前 `manifest.name` 对应配置。
- 对 key 增加严格 regex 和冲突检测；跨 plugin 共享必须通过显式 host-owned capability 或 event bus，而不是共享 env key。
- SDK 文档同步更新，明确 `setSharedConfig()` 只写本 plugin namespace。

**验证**

- 新增 server/desktop plugin loader tests：两个 plugin 都写 `SOCKET` 时互不覆盖；每个 `ServerPluginContext.sharedConfig` 只看到自己的值。
- browser-use integration：`plugins/browser-use/src/server.ts` 仍能收到自己的 socket path。
- 静态检查：禁止直接读取全局 `CRADLE_PLUGIN_*`，集中到 plugin config resolver。

---

### 4. High — browser-use backend socket 无鉴权，任意本地客户端可驱动 webview

**证据**

- `plugins/browser-use/src/desktop.ts:490-507` 在 `ctx.userDataPath/browser-backend.sock` 启动 socket server，并把路径写入 shared config。
- `plugins/browser-use/src/desktop.ts:477-486` 对每个 socket connection 只做 frame decode，然后直接 `handleCommand()`；没有 token、peer 校验、mode gate 或 capability check。
- 该 command surface 很强：`navigate` 在 `plugins/browser-use/src/desktop.ts:207-223`，`screenshot` 在 `plugins/browser-use/src/desktop.ts:226-234`，任意 page-context `eval` 在 `plugins/browser-use/src/desktop.ts:454-465`。
- `plugins/browser-use/src/mcp-server.ts:96-119` 还提供了固定路径 fallback；即使没有 env，客户端也会尝试 OS 默认 Cradle userData 位置。
- `plugins/browser-use/src/desktop.ts:495-497` 启动时直接 unlink 现有 socket path，没有校验该 path 是否属于当前进程的 stale socket。

**为什么重要**

browser-use backend 的能力等价于“控制并读取 Cradle 内嵌浏览器页面”。当前设计只靠 userData path 的可发现性和本地用户边界隔离。任何同用户本地进程都可以直接连接 socket 并发送 protocol frame，不需要经过 MCP registry、plugin owner 或 agent approval。这对开发工具可能可接受，但应该是显式 threat model，而不是隐式副作用。

**推荐修复方向**

- desktop plugin 生成随机 session token，传给 server plugin/MCP process，并要求每个 socket frame 带 token 或先完成 auth handshake。
- socket 文件放在 per-run private directory，目录权限设置为 `0700`；启动时只清理自己 pid/token 标记过的 stale socket。
- MCP server 禁止默认路径 fallback，除非显式 dev mode；生产只接受 host 注入的 socket path/token。
- 对 `eval` 增加明确 capability flag 或 approval path，至少区分 read-only commands 与 arbitrary script execution。

**验证**

- 单元测试：无 token 的 socket client 不能执行 `tabs_list`/`eval`；错误 token 被拒绝；正确 token 能执行。
- 手工验证：browser-use MCP tools 仍能导航、截图、列 tab。
- 权限检查：在 macOS/Linux 上确认 socket parent directory mode 不是 world-writable；Windows named pipe 行为需要单独验证。

---

### 5. Medium — active browser-use backend 与 legacy desktop backend 重复，旧实现仍在源码中承载错误语义

**证据**

- active path 在 `plugins/browser-use/src/desktop.ts:44-62`、`63-134`、`204-475`、`490-537` 实现 registry、debugger attach、command dispatch、socket lifecycle。
- legacy path 在 `apps/desktop/src/main/browser-backend.ts:47-58`、`69-107`、`109-363`、`382-450` 实现高度相似的一套 registry、debugger attach、command dispatch、socket lifecycle。
- `apps/desktop/src/main/README.md:22` 明确 `browser-backend.ts` 是 legacy，`apps/desktop/src/main/README.md:32` 又说明它不应作为新功能入口继续扩展。
- `rg "startBrowserBackend|stopBrowserBackend|getBrowserBackendSocketPath"` 只找到 `apps/desktop/src/main/browser-backend.ts` 自身导出，没有发现当前 main process 启动它。

**为什么重要**

两套 backend 对同一 protocol 和同一 webview/CDP 生命周期建模。active plugin backend 已经增加了 renderer tab bridge、screenshot timeout、active tab lookup 等行为；legacy backend 的 `tabs_new` 仍只是复用 active webview，不拥有 browser panel tab creation 语义。保留大段未启动但可编译的旧实现，会让安全修复、protocol 变更和 bugfix 容易只落到其中一份，后续读代码的人也会误判 owner。

**推荐修复方向**

- 最好删除 `apps/desktop/src/main/browser-backend.ts`，把 browser automation backend ownership 单一化到 `plugins/browser-use`。
- 如果需要兼容路径，把可复用 command dispatcher 抽到 `@cradle/browser-use` 的 host-neutral module，desktop legacy wrapper 只负责 adapter，不复制协议实现。
- README 保留迁移说明，但源码不应保留完整 inactive implementation。

**验证**

- `rg "browser-backend|startBrowserBackend|registerWebview"` 不再出现 inactive runtime implementation。
- `pnpm --filter @cradle/browser-use build` 和 desktop typecheck/build 通过。
- browser-use protocol tests 继续覆盖 command encoding/decoding 与 command builder。

---

### 6. Medium — desktop server child process supervisor 状态机过于隐式，停止和重启没有可验证生命周期

**证据**

- `apps/desktop/src/main/server-process.ts:16-23` 使用 module-level `serverProcess`、`restartCount`、`currentServerUrl`。
- `apps/desktop/src/main/server-process.ts:46-72` fork server 后注册 stdout/stderr，但没有注册 `error` event handler。
- `apps/desktop/src/main/server-process.ts:82-101` 在 `exit` handler 内递归调用 `spawnServer(opts)`，并依赖 global `currentServerUrl` 做 readiness check。
- `apps/desktop/src/main/server-process.ts:171-175` 的 `stopServer()` 只发 `SIGTERM` 并立即把 `serverProcess = null`，没有等待退出，也没有超时后 `SIGKILL`。
- `apps/desktop/src/main/main-app.ts:159-163` 在 `before-quit` 中调用 `stopServer()`，但无法等待 server 真正退出。

**为什么重要**

这是典型 helper 状态机 anti-pattern：进程的真实状态、期望状态、restart policy、shutdown policy 都散在 closure 和 globals 里。fork 失败、server 挂起不响应 SIGTERM、退出和重启并发、或 app quit 期间 exit handler 行为，都很难单元测试。server 子进程还持有 DB、PTY、plugin runtime 等资源，关闭不确定会放大后续数据一致性问题。

**推荐修复方向**

- 提取 `DesktopServerProcessSupervisor`，显式状态为 `idle | starting | running | stopping | crashed`。
- `start()`、`stop()` 返回 Promise；`stop()` 等待 `exit`，超时后 escalates to `SIGKILL`。
- fork 后监听 `error`、`exit`、readiness timeout，并在 intentional stop 时禁用 restart。
- `restartCount` 在稳定运行后重置，restart 期间清理旧 listeners。

**验证**

- 用 fake child process 为 supervisor 写单元测试：start success、fork error、unexpected exit restart、intentional stop no restart、SIGTERM timeout 后 SIGKILL。
- Desktop smoke：关闭 app 后 server 子进程不存在，DB 文件不被旧进程占用。

---

### 7. Medium — Rust `codex_exec` timeout helper 会在子进程已退出后继续按 PID `SIGKILL`

**证据**

- `chronicle/src/codex_exec.rs:49-59` 为 timeout 单独 spawn thread，睡眠后调用 `libc::kill(child_id as i32, libc::SIGKILL)`。
- `chronicle/src/codex_exec.rs:61-67` 主线程 `wait_with_output()` 完成后只是 `drop(killer)`，并没有取消 killer thread；注释认为 dead PID 上 kill 是 no-op。
- `chronicle/src/codex_exec.rs:69-80` 通过 exit signal 9 推断 timeout。

**为什么重要**

PID 是可复用资源。快速结束的 child 在 timeout 到达前已经退出，killer thread 仍会醒来并对旧 PID 发 `SIGKILL`；如果 OS 已复用该 PID，理论上可能杀错进程。即使概率低，这也是 unsafe process management helper，不应作为未来 LLM-backed summary boundary 继续扩散。

**推荐修复方向**

- 使用可取消 timeout 机制：`wait-timeout` crate、poll `try_wait()` loop，或 channel 通知 killer thread 退出。
- 避免裸 `libc::kill(pid)`，优先保留 child handle 并调用 `child.kill()`。
- 非 Unix 行为需要 cfg gate 或跨平台实现。

**验证**

- Rust 单元测试：短命令在 timeout 后不会触发 late kill path；长命令会被 timeout 杀掉并返回 timeout error。
- `cargo test` from `chronicle/`。

---

### 8. Medium — desktop/server plugin source resolution 分裂，multi-layer plugin 会出现发现范围不一致

**证据**

- Desktop source resolver 在 `apps/desktop/src/main/plugin-loader.ts:106-137`：dev 用 workspace `plugins`，prod 用 `process.resourcesPath/plugins`，还读取 `CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS` 和 `CRADLE_EXTERNAL_PLUGINS_DIRS`。
- Server source resolver 在 `apps/server/src/plugins/loader.ts:35-50` 和 `apps/server/src/plugins/loader.ts:67-73`：读取 `CRADLE_PLUGINS_DIR` 和 `CRADLE_EXTERNAL_PLUGINS_DIRS`，但不读取 `CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS`。
- Desktop 侧 descriptor/duplicate logic 在 `apps/desktop/src/main/plugin-discovery.ts:72-98`、`133-165`；server 侧 runtime registry 的 duplicate/route logic 在 `apps/server/src/plugins/runtime-registry.ts:151-170`。

**为什么重要**

plugin 是跨 desktop/server/web 的 multi-layer capability，但发现源由两个进程各自解析。一个外部 plugin 如果只在 `CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS` 中出现，desktop layer 可以激活并写 shared config，server layer 却不会发现；反过来 `CRADLE_PLUGINS_DIR` 只影响 server 默认目录。descriptor governance 也重复实现，长期会出现“desktop 认为 active、server 认为 missing/invalid”的状态漂移。

**推荐修复方向**

- 抽取共享 plugin source resolver 到 `@cradle/plugin-sdk` 或 host-owned package，desktop/server 只传 deployment context。
- 明确 env contract：哪些变量是 all-layer source，哪些只允许 desktop-only；如果 desktop-only source 含 server entry，应产生 diagnostic 而不是静默跳过。
- 统一 duplicate identity/route collision 规则和 descriptor shape。

**验证**

- 测试矩阵：workspace dev、bundled resource、`CRADLE_PLUGINS_DIR`、`CRADLE_EXTERNAL_PLUGINS_DIRS`、desktop-only external dir。
- 插件列表 API 和 desktop descriptor projection 对同一 plugin 的 identity/source/layer state 一致。

---

### 9. Low — Electron native rebuild helper hard-codes Electron version，容易与 package manager 解析结果漂移

**证据**

- `apps/desktop/scripts/rebuild-server-native.mjs:7-21` 默认使用 `CRADLE_ELECTRON_VERSION ?? '39.8.10'` 调 `electron-rebuild`。
- `apps/desktop/package.json:36` 依赖是 `"electron": "^39.2.6"`，当前 lockfile 解析到 `39.8.10`，所以今天是对齐的，但机制上不是从 installed Electron 读取。

**为什么重要**

这是 helper/config duplication。只要 lockfile 更新到新的 Electron patch/minor，native modules 可能仍按旧 ABI rebuild，桌面包在 SQLite/PTY 等 native dependency 上出错。由于该脚本服务 packaging pipeline，失败会出现在较晚阶段。

**推荐修复方向**

- 从 `electron/package.json` 或 `electron` package API 解析实际 installed version。
- 或将 Electron 版本 pin 成 workspace 单一常量，并让 `package.json` 与 rebuild script 都从同一来源生成。

**验证**

- 脚本单元/fixture 测试：mock installed Electron version，确认 rebuild 参数使用真实版本。
- `pnpm --filter @cradle/desktop build` 覆盖 native rebuild path。

## Checked Without Finding Issues

- Electron window defaults：主窗口 `apps/desktop/src/main/main-app.ts:61-67` 和 tearoff/devtool window `apps/desktop/src/main/window-manager.ts:45-55`、`128-137` 都设置了 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。问题主要是 preload 暴露面过宽，不是这些基础开关缺失。
- Webview attach hardening：`apps/desktop/src/main/main-app.ts:119-123` 在 `will-attach-webview` 删除 preload 并关闭 node integration；未发现 webview 直接获得 Node 能力。
- `openExternal` protocol check：`apps/desktop/src/main/native-services.ts:47-52` 限制为 `https:`、`http:`、`mailto:`，未发现任意 scheme 直接打开。
- Skills namespace ownership：`apps/server/src/modules/skills/skills-paths.ts:23-26` 只读 legacy `~/.agents/skills`，`apps/server/src/modules/skills/skills-paths.ts:49-52` 禁止写 `builtin`/`legacy`；create/update/delete/import 在 `apps/server/src/modules/skills/skills.store.ts:132-150`、`164-210`、`213-232` 都调用 writable-scope guard。这个表面未发现写入 foreign namespace。
- Server plugin duplicate protection：`apps/server/src/plugins/runtime-registry.ts:151-170` 会标记 duplicate identity 和 route collision；desktop 侧 `apps/desktop/src/main/plugin-discovery.ts:133-165` 也有类似保护。问题是规则重复和 source resolver 分裂，不是完全没有 collision handling。
- Observability debugger skill：`resources/skills/observability-debugger/scripts/obs_debug.py:77-96`、`140-159`、`162-197`、`200-230` 使用参数绑定构建查询；`resources/skills/observability-debugger/SKILL.md:91-95` 明确 guardrail 是不修改 DB。未发现它会 mutate SQLite。`bundle` 会写用户指定 JSON 输出，这是该命令的预期行为。
- `resources/skills/cradle-cli/SKILL.md:126-154` 的 generated module block 有明确 markers；未发现手写区与生成区混淆。

## Uncertainties

- 没有运行测试或启动 Electron；这是源码级 scan report。
- Windows 下 `node:net` 对 `ctx.userDataPath/browser-backend.sock` 的 IPC path 行为没有验证。当前实现看起来更像 Unix domain socket path，Windows named pipe 可能需要额外适配。
- `apps/desktop/src/main/browser-backend.ts` 是否进入最终 main bundle没有通过 bundle analyzer 验证；`rg` 和 README 均显示它不在 active startup path。
- Browser-use socket 当前可能被视为 developer-tool local trust boundary。如果产品决策是“同用户本地进程全信任”，Finding 4 的 severity 可降到 Medium，但仍建议把该假设写入 threat model 并加入 token/permission hardening backlog。
- 插件 shared config 是否会承载 secret 目前只看到 socket path 用例；Finding 3 的风险来自 public SDK 形态和未来扩展，不是已确认 secret 泄漏。

## Quality Gate

- 本文件是自包含 handoff，包含 scope、severity、证据、影响、推荐修复方向、验证方式、checked-without-issue notes 和 uncertainties。
- 已覆盖指定的 desktop/Rust/plugins/helper 表面，以及与 server/web 交互的 cross-process helper。
- 报告区分了确认问题、低风险 smell、检查未发现问题和不确定性。
- 除本报告文件外未修改其他文件；没有执行破坏性命令。
