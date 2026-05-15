# PTY WebSocket Live Channel Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `docs/exec-plans/README.md` and the ExecPlan `PLANS.md` convention used by this repository.

## Purpose / Big Picture

Cradle 现在的 PTY 终端能力把长寿命的 PTY runtime、可回放的终端状态、短寿命的 SSE 连接放进了同一个 owner 里。用户已经看到了这个边界错误带来的直接后果：页面断开或重连后，服务端还可能继续向一个已经关闭的 `ReadableStream` 写数据，最终把 `apps/server` 自己打崩。这个问题的本质不是某个 `enqueue()` 少了 `try/catch`，而是 PTY 的 live session 语义被错误地塞进了单向 SSE transport。

本计划完成后，用户能得到三个当前不稳或做不到的结果。第一，`cli-tui` 聊天终端和底部 shell 终端都通过同一条 WebSocket live channel 处理输出、输入、resize、exit 与连接存活，页面 refresh、组件 remount 或网络闪断不再让 server 因 closed stream 崩溃。第二，PTY 的生命周期边界会重新清晰：HTTP 继续拥有 start-or-attach、delete 等资源语义，WebSocket 只拥有 live session 语义，`session` / `profile` 删除仍然是 PTY 销毁的唯一 domain owner。第三，前端会从直接内联 `EventSource` 迁移到显式的 PTY channel adapter，服务端也会把 `pty.manager.ts` 从“runtime + SSE encoder”拆成 transport-neutral runtime、timeline 和 WebSocket adapter，后续再看 SSE、CLI-TUI、generic shell 或多端 attach 行为时，不需要再把 transport 和 owner 搅在一起。

用户可见的验收方式必须围绕终端真实体验而不是内部事件。启动 `apps/server` 与 `apps/web` 后，进入一个 `cli-tui` session，终端应正常展示历史输出；输入一条命令后能立即看到回显；调整终端尺寸后命令继续运行且内容不丢失；刷新 tab 或重新进入页面后终端恢复，不会让 server 崩溃；删除 session 或删除所属 profile 后终端退出并显示一次性 exit 提示。底部 shell 也应保持同样的行为。

## Progress

- [x] (2026-05-15 09:52 local) 定位 PTY 崩溃根因：`apps/server/src/modules/pty/pty.manager.ts` 在 SSE subscriber 未清理的情况下继续向已关闭的 `ReadableStreamController` 写数据，closed transport failure 升级成 server process crash。
- [x] (2026-05-15 10:01 local) 完成协议决策：PTY 不再继续使用 `SSE output + HTTP input/resize` 作为长期目标，改为 capability-specific transport——HTTP 保留资源生命周期，WebSocket 承载 live channel。
- [x] (2026-05-15 10:10 local) 审核当前 PTY server/client 架构、现有测试面、文档漂移和与 `20260510-01-apps-server-elysia-replatform.md` 的方向冲突，确认这是一次有意的 capability-level 例外而不是偶然实现偏移。
- [x] (2026-05-15 10:18 local) 制定 multi-work 执行方式：Main Agent 保留协议和 owner 决策；Server workstream、Web workstream 可在协议冻结后并行；Validation/Docs workstream 在二者落地后收口。
- [x] (2026-05-15 10:22 local) 起草本 ExecPlan 初稿并登记需要同步更新的目录 README 与文档清单。
- [x] (2026-05-15 10:28 local) 读取 Elysia WebSocket / unit-test / Node 参考并完成 reviewer 审查，确认 WebSocket route 需使用 Elysia `.ws()` 定义，`app.handle()` 仅覆盖 HTTP，WebSocket 验证必须启动真实 Node listener。
- [x] (2026-05-15 10:31 local) 收敛 owner 边界：chat `cli-tui` 终端继续是 session-owned durable PTY；generic shell 改为 panel-owned ephemeral PTY，卸载时显式 `DELETE`，异常断连由 server lease/TTL 清理。
- [x] (2026-05-15 11:06 local) 根据用户新指令，将实施策略从“短命双轨迁移”改为“直接 breaking cutover”：不再保留 SSE `/stream` 兼容层，直接以 WebSocket live channel 替换旧流式路径。
- [ ] 建立 transport-neutral PTY runtime/timeline，并引入 WebSocket live channel 的 server 端实现。
- [ ] 引入前端共享 PTY channel adapter，并将 `TuiView` / `ShellView` 从 `EventSource` 迁移到 WebSocket。
- [ ] 新增用户可感知的终端回归验证，删除旧 SSE stream 路由与相关文档陈迹，完成 build/typecheck/test/E2E 验收。

## Surprises & Discoveries

- Observation: 当前崩溃点只是症状，真正的问题是 `pty.manager.ts` 同时拥有 process lifecycle、buffer replay 和 SSE framing。
  Evidence: `apps/server/src/modules/pty/pty.manager.ts` 既维护 `sessions` / `subscribers`，又在 `openStream()` 里直接执行 `controller.enqueue(encoder.encode(\`data: ${JSON.stringify(event)}\\n\\n\`))`。

- Observation: 最近的 server replatform ExecPlan 明确写过“当前 web 主要使用 SSE，因此不在那一轮引入 WebSocket 替代 SSE”；本计划将对 PTY capability 作出有意例外。
  Evidence: `docs/exec-plans/20260510-01-apps-server-elysia-replatform.md` 的流式里程碑把 chat-runtime 与 PTY 一并归为 SSE 壳；而本次用户问题直接来自 PTY live session 与 SSE transport 的边界错配。

- Observation: `apps/server/specs/capabilities/pty.md` 说第一阶段不迁 generic bottom-shell，但当前实现里 `/terminal-sessions/shell/*` 和 `ShellView` 已经存在，并与 chat session PTY 共用同一个 runtime manager。
  Evidence: `apps/server/src/modules/pty/index.ts` 暴露 `/shell/*` 路由，`apps/web/src/features/tui/shell-view.tsx` 直接消费该路径。

- Observation: PTY 的前端真实用户路径目前缺少自动化回归，现有高价值覆盖几乎都在 server 的 `tests/pty.test.ts`，这不足以证明 UI 体验没有退化。
  Evidence: `apps/server/tests/pty.test.ts` 覆盖 buffer/data/exit 和 cleanup，但 `e2e/src/features/` 里没有终端场景，`apps/web/src/features/tui/` 也没有对应测试。

- Observation: `apps/web/src/features/tui/README.md` 与若干 for-users 文档仍残留 IPC/`window.ptyPush` 叙述，说明 PTY transport 文档早已落后于实现。
  Evidence: Explore 调研结果显示 `apps/web/src/features/tui/README.md`、`docs/for-users/integrations-guide.md`、`docs/for-users/ipc-api-reference.md` 均未与当前 server-first PTY 对齐。

- Observation: 当前仓库根目录没有 `pnpm build` 这个脚本，而 E2E 基础设施也不是“先 build 再跑浏览器”，而是由 `e2e/src/support/server-lifecycle.ts` 托管独立 server/web 进程。
  Evidence: 根 `package.json` 只有 `build:server`、`build:web`、`build:desktop`；`e2e/src/support/server-lifecycle.ts` 会直接启动 `apps/server` 与 `apps/web` 的开发进程。

- Observation: Elysia 的 `app.handle(new Request(...))` 只适用于 HTTP Request/Response 测试；WebSocket route 需要真实 listener + 真实 client 才能验证 `open/message/close` 生命周期。
  Evidence: Elysia unit-test 文档把 `handle()` 定义为 Web Standard Request 测试入口，而 WebSocket 文档要求使用 `.ws()` route 并在真实连接上消费消息。

## Decision Log

- Decision: PTY 采用 capability-specific transport：HTTP 继续拥有 `start-or-attach`、`delete` 等资源生命周期；WebSocket 拥有 output/input/resize/exit/heartbeat/live reconnect 等会话语义。
  Rationale: 终端是全双工设备会话，不是单向事件广播；但 start/stop/delete 仍然是显式资源语义，保留在 HTTP 可保持 owner 清晰并减少一次性迁移风险。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: 不直接在现有 `pty.manager.ts` 上打补丁，而是将其拆成 transport-neutral runtime、timeline 和 WebSocket adapter 三个层次。
  Rationale: closed stream 崩溃只是 transport leakage 的表现。若仍让 runtime 直接持有 `ReadableStreamController` 或 WebSocket 实例，未来只会重复同类错误。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: 直接执行 breaking cutover，不保留 SSE `/stream` 兼容层或 legacy event 名称。server 与 web 都直接切到 WebSocket live channel，旧 `terminal.buffer/data/exit` 语义与 `/stream` route 在实施过程中一并删除。
  Rationale: 当前仍处于开发期，没有真实外部用户；继续维持双轨只会拖慢重构、让 runtime/timeline/transport 边界再次被兼容性代码污染。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: session/profile cleanup 语义保持不变。删除 chat session 或删除 owning profile 仍必须终止其 PTY runtime；React unmount 或 WebSocket close 不得自动销毁 PTY。
  Rationale: 这是当前产品已经建立的 owner 语义，属于 domain lifecycle，不应被 transport 改造打碎。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: WebSocket 首帧采用 snapshot/tail 模型，而不是继续沿用 `terminal.buffer` 特判。服务端维护有界 timeline 与单调递增 `seq`，客户端重连时通过 `fromSeq` 恢复，追不上时退回 snapshot。
  Rationale: `terminal.buffer` 和 `initialBufferDelivered` 只是对“从某个游标恢复 live stream”的临时模拟。既然切到 WebSocket，就应把恢复语义做成正式协议。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: approval、chat-runtime 等更偏单向时间线的流式能力不在本计划中被一并迁到 WebSocket；本计划只处理 PTY capability。
  Rationale: 本次变更要服务的是 PTY 的设备会话语义，而不是全仓库 transport 统一运动。避免借机过度扩张范围。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: generic bottom shell 与 chat `cli-tui` 终端不再共享 owner 语义。chat 终端继续是 session-owned durable PTY；bottom shell 是 panel-owned ephemeral PTY，关闭 panel、卸载 `ShellView` 或切换 generation 时显式 `DELETE /terminal-sessions/shell/:ptyId`，异常断连由 server lease/TTL 在宽限期后兜底清理。
  Rationale: `shell:${sessionId}:${generation}` 本来就是 UI-scoped identity，不具备 chat session 那样的 durable owner。若继续把它当作可跨页面长期存活的对象，只会制造孤儿进程与语义混乱。
  Date/Author: 2026-05-15 / GitHub Copilot

- Decision: WebSocket 测试使用真实 Elysia Node listener + Node 内建 `WebSocket` client；只有当 Node 内建 client 实测不足时，才在 `apps/server` 增加专门的 ws 测试依赖。
  Rationale: 这符合当前 Node 24 环境，也避免先引入不必要的新库；如果后续证明额外依赖能显著提升测试可维护性，则允许安装并记录原因。
  Date/Author: 2026-05-15 / GitHub Copilot

## Outcomes & Retrospective

当前结果是完成了协议和 owner 边界的重定义，但尚未进入代码实施阶段。我们已经确认：本次工作不是“修一个 SSE 清理 bug”，而是把 PTY 从单向流错误抽象重新定义为 live session。更重要的是，本计划已经把一个潜在的“全仓库改 WebSocket”冲动收束成了 capability-specific 方案：只有 PTY live channel 例外切到 WebSocket，其余只读时间线继续保留 SSE。这个边界如果不先写清楚，后续任何并行实施都会漂移。

尚未完成的部分集中在三个地方。第一，server 端如何在不破坏 session/profile cleanup 的前提下把 `pty.manager.ts` 拆开。第二，web 端如何把 `TuiView` 与 `ShellView` 收敛到一个共享 channel adapter，而不是复制两套 socket 逻辑。第三，如何用用户可感知的验证证明“刷新、重连、继续输入命令”这条真实链路已经修好，而不是仅仅 server 测试变绿。

在执行阶段，每个停顿点都必须回写本节，尤其要记录是否成功删除 SSE stream route、是否保留了 shell path、以及真实 E2E 是否覆盖了用户能看见的终端行为。

## Context and Orientation

`apps/server` 里的 PTY 能力现在位于 `apps/server/src/modules/pty/`。`index.ts` 是 route surface，当前暴露两组接口：一组是 `GET /terminal-sessions/:sessionId/stream`、`POST /start-or-attach`、`POST /input`、`POST /resize`、`DELETE /:sessionId`，服务 `cli-tui` chat session；另一组是 `/terminal-sessions/shell/*`，服务底部通用 shell。`service.ts` 负责根据 `sessionId` 解析 `session -> workspace -> agentProfile`，并保证只有 `providerKind === 'cli-tui'` 的 chat session 才能启动 session-owned PTY，同时注册 `SessionService.onSessionCleanup()` 使 session 删除会触发 `ptyManager.destroy(sessionId)`。`pty.manager.ts` 当前是模块级单例，内部维护 PTY child process、buffer、exit 状态和 subscriber 集合。当前崩溃就发生在这里：HTTP/SSE transport 的 controller 被关掉后，runtime 仍持有 stale subscriber。

`apps/web` 的终端 UI 在 `apps/web/src/features/tui/`。`tui-view.tsx` 是 chat session 主视图，在 `apps/web/src/tabs/chat.tab.tsx` 中按 `agentProfile.providerKind === 'cli-tui'` 条件渲染。`shell-view.tsx` 是底部 panel 的通用 shell，借助 `shell-api.ts` 与 server 通讯。两者都使用 xterm.js，但 transport 都是内联的：先通过 HTTP 启动或 attach，再 `new EventSource(.../stream)` 读输出，输入与 resize 走 HTTP POST。这里必须区分两种 owner。chat `cli-tui` PTY 是 session-owned durable runtime，React unmount 不会 stop 它；generic shell 则不是 durable 业务对象，而是 panel-owned scratch terminal，当前实现却没有在卸载时显式 stop，导致 transport 断开后容易留下孤儿进程。本计划会把这两个 owner 模型正式分开。

本计划中的“runtime”指的是被 `node-pty` 启动的子进程与其进程级状态；“timeline”指的是每个终端 session 当前快照、最近输出事件和单调递增序号组成的可恢复状态；“live channel”指的是浏览器与 server 之间承载输入、resize、输出、exit、heartbeat 的 WebSocket 会话；“snapshot”指的是新连接在无法从既有 `seq` 继续时，server 一次性发送的当前终端全文本与状态；“tail”指的是 snapshot 之后的增量输出流。后续所有实现都必须遵守这四个概念的边界，不允许重新把它们折叠回一个 `manager`。

## Plan of Work

本计划采用 multi-work 执行，但 architecture decision 始终由 Main Agent 持有。实施前先冻结协议：HTTP 保留 `start-or-attach` 和 `delete`；WebSocket 新增 live channel route；旧 SSE `/stream` 只作为短命迁移桥，不再是目标架构。协议冻结后把工作拆成三个可管理的 workstream。

Workstream A 是 server transport refactor，目标是在 `apps/server/src/modules/pty/` 内部把当前 `pty.manager.ts` 拆成三个明确 owner。第一层是 runtime owner，例如 `pty.runtime.ts`，只管理 spawn、write、resize、kill、exit 与 session registry，不知道 HTTP 或 WebSocket。第二层是 timeline owner，例如 `pty.timeline.ts`，维护 `seq`、recent events ring buffer、snapshot text 与 exit state，并提供“从某个序号之后读取增量，不足则回退 snapshot”的 API。第三层是 transport adapter，例如 `pty.socket.ts`，负责把 runtime/timeline 暴露成 WebSocket session。`service.ts` 继续承担 session/profile/workspace 解析与 owner 语义，不把 transport 细节塞回去。`index.ts` 要新增两个 WebSocket route：一个用于 chat terminal，例如 `/terminal-sessions/:sessionId/socket`；一个用于 generic shell，例如 `/terminal-sessions/shell/:ptyId/socket`。这一步会直接删除旧 `/stream` route、`terminal.buffer/data/exit` legacy 事件名以及相关 subscriber 模型，不保留兼容桥。

Workstream B 是 web transport migration，目标是在 `apps/web/src/features/tui/` 中创建共享 PTY channel adapter，例如 `pty-channel.ts`，让 `TuiView` 与 `ShellView` 不再直接持有 `EventSource`。这个 adapter 负责：打开 socket、发送 input/resize、处理 snapshot/output/exit、记录 `lastSeq`、连接断开后的重连策略，以及 exit 后主动停掉 socket。这里还要新增统一的 `http -> ws` / `https -> wss` URL 派生 helper，避免两个 view 自己拼字符串。`TuiView` 和 `ShellView` 只保留 xterm 渲染、用户输入、resize observer 与 UI 生命周期，不再各自重复 transport 状态机。迁移时必须保证用户可见行为不变：chat terminal 首屏能看到历史输出，exit banner 只写一次；generic shell 的 `onExited` 与 generation 轮换仍然生效，并且 `ShellView` 卸载时显式执行 shell delete，而不是仅关闭 socket。

Workstream C 是 validation/docs/cleanup，它依赖 A 与 B 达到可联调状态后再收口。这里要做四类事。第一，补 server 测试和 web/E2E 验证，覆盖 snapshot、增量输出、resize、删除 session/profile、chat terminal 页面 remount、generic shell 的 panel close/unmount，以及 socket 异常断开后的 lease cleanup。第二，更新 OpenAPI 与手写 API 帮助层，使 HTTP 控制面仍然清晰，而流式面被明确标注为 WebSocket 旁路。第三，清理旧 SSE `/stream` 路由、`terminal.buffer` 特判、`initialBufferDelivered` 状态机以及 `EventSource` 代码的残留引用，确保最终树上不留兼容分支。第四，更新 `apps/server/specs/capabilities/pty.md`、`apps/server/src/modules/pty/README.md`、`apps/web/src/features/tui/README.md`、`docs/for-users/*` 和本目录 README，让实现与文档重新一致。

Milestone 1 的验收是 server 端出现 transport-neutral PTY core，并且 WebSocket route 能独立工作，哪怕 web 还未切换。Milestone 2 的验收是 web 两个终端视图都已经使用同一条 WebSocket live channel。Milestone 3 的验收是删除 SSE path 和相关状态机后，build/typecheck/test/E2E 全绿，且用户真实终端路径稳定。

## Concrete Steps

所有命令默认在仓库根目录 `/Users/wibus/dev/Cradle` 执行，除非命令前明确切目录。每个 Milestone 完成后都必须回写本文件的四个 living sections，并更新 `docs/exec-plans/README.md` 中的文件清单说明。

1. 先记录现有 PTY 基线与相关验证面，确保后续新增错误能被识别：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm vitest run tests/pty.test.ts
       cd /Users/wibus/dev/Cradle/apps/server && pnpm typecheck
       cd /Users/wibus/dev/Cradle/apps/web && pnpm typecheck

   预期结果是当前 `tests/pty.test.ts` 通过，但它仍然围绕 SSE `data: ...\n\n` 解析；这正是后续需要重写而不是继续扩展的证据。

2. 在 server 端冻结协议并实现 transport-neutral core。优先编辑：

   - `apps/server/src/modules/pty/pty.manager.ts`（拆分并最终删除或改名）
   - `apps/server/src/modules/pty/service.ts`
   - `apps/server/src/modules/pty/index.ts`
   - 新增 `apps/server/src/modules/pty/pty.runtime.ts`
   - 新增 `apps/server/src/modules/pty/pty.timeline.ts`
   - 新增 `apps/server/src/modules/pty/pty.socket.ts`
   - 视需要新增 `apps/server/src/modules/pty/protocol.ts`

    这里直接删除旧 `/stream` route、`terminal.buffer/data/exit` 事件名与 legacy subscriber 逻辑。新的 WebSocket route 需要使用 Elysia `.ws()` 显式定义，并在 query 中接收可选 `fromSeq`。推荐形态如下：

       .ws('/terminal-sessions/:sessionId/socket', { query: t.Object({ fromSeq: t.Optional(t.Numeric()) }), ... })
      .ws('/terminal-sessions/shell/:ptyId/socket', { query: t.Object({ fromSeq: t.Optional(t.Numeric()) }), ... })

     WebSocket 测试不能用 `app.handle()`，而要在 `apps/server/tests/pty-websocket.test.ts` 中启动一个真实的 Elysia Node listener（随机端口即可），再用 Node 内建 `WebSocket` client 连接，断言 `snapshot -> output -> exit` 消息顺序、`input`/`resize` 可达以及 close 后 lease/cleanup 行为。完成后运行：

      cd /Users/wibus/dev/Cradle/apps/server && pnpm vitest run tests/pty-websocket.test.ts
       cd /Users/wibus/dev/Cradle/apps/server && pnpm typecheck && pnpm build

     若 Node 内建 `WebSocket` client 在 Vitest/Node adapter 下不足以稳定验证消息序列，可以在 `apps/server` 增加专门的 ws 测试依赖，并在 `Decision Log` 与 `Artifacts and Notes` 中记录安装原因与用法。

3. 在 web 端引入共享 channel adapter 并迁移两个终端视图。优先编辑：

   - `apps/web/src/features/tui/tui-view.tsx`
   - `apps/web/src/features/tui/shell-view.tsx`
   - `apps/web/src/features/tui/shell-api.ts`
   - 新增 `apps/web/src/features/tui/pty-channel.ts`
   - 视需要新增 `apps/web/src/features/tui/pty-protocol.ts`

   完成后运行：

       cd /Users/wibus/dev/Cradle/apps/web && pnpm typecheck
       cd /Users/wibus/dev/Cradle && pnpm typecheck

  如果 web 端还需要依赖 server 新增的 HTTP path 或手写 URL helper，同步更新相关 helper 文件，但不要让 `TuiView` / `ShellView` 再直接 new socket 并重复协议解析。这里必须补上 `getSocketBaseUrl()` 之类的 helper，并明确 `ShellView` 在 cleanup 时先执行 shell delete，再关闭 transport，以匹配它的 panel-owned owner 语义。

4. 补用户可感知验证并确认 breaking cutover 已经完成。这里至少要新增一个终端 E2E 场景，放在 `e2e/src/features/` 与 `e2e/src/steps/` 下，围绕“打开终端、输入命令、看到输出、刷新/重连、继续工作”而不是内部 event count。标签应遵守仓库习惯，例如 `@cradle @P1 @CRADLE-PTY-001`。当前 E2E 基础设施会自己托管 `apps/server` 与 `apps/web`，因此这里不需要虚构一个根目录 `pnpm build`。命令顺序应为：

       cd /Users/wibus/dev/Cradle && npx cucumber-js --config e2e/cucumber.mjs --tags "@cradle and @P1 and @CRADLE-PTY-001"
       cd /Users/wibus/dev/Cradle/apps/server && pnpm test
       cd /Users/wibus/dev/Cradle/apps/server && pnpm build
       cd /Users/wibus/dev/Cradle/apps/web && pnpm build && pnpm typecheck
       cd /Users/wibus/dev/Cradle && pnpm typecheck

  只有当 E2E 能证明 chat terminal 的刷新/重连行为正确，shell 的 panel close/unmount 行为正确，且 server/web test、typecheck、build 都通过后，这次 breaking cutover 才算完成。

5. 最后收口文档与目录 README。至少更新：

   - `docs/exec-plans/README.md`
   - `apps/server/specs/capabilities/pty.md`
  - `apps/server/src/modules/pty/README.md`
   - `apps/web/src/features/tui/README.md`
   - `docs/for-users/integrations-guide.md`
   - `docs/for-users/ipc-api-reference.md`

   更新后再次运行最小验证：

       cd /Users/wibus/dev/Cradle/apps/server && pnpm typecheck && pnpm test
       cd /Users/wibus/dev/Cradle/apps/web && pnpm typecheck

## Validation and Acceptance

本计划的验收必须面向用户看到的终端行为，而不是只面向 server 内部事件结构。下面这些行为必须全部成立。

启动 `apps/server` 与 `apps/web` 后，进入一个 `providerKind === 'cli-tui'` 的 chat session，主终端应显示已有输出而不是空白页；输入一条简单命令后，例如 `echo cradle-ws-test`，xterm 中应立刻看到回显；拖动或改变容器尺寸后终端仍可继续输入并收到输出。关闭页面、刷新页面或销毁再重建 React 组件后，server 不应崩溃，chat terminal 应能恢复到当前状态并继续工作，而不是重复刷出整屏旧 buffer 或只剩一个挂死连接。删除当前 session 或删除其所属 profile 后，chat terminal 应收到一次 exit 提示，并且 live channel 关闭。generic shell 的验收不同：它必须在同一 panel session 内支持 socket 级重连，但关闭 panel、切换 generation 或卸载 `ShellView` 时必须显式终止 shell PTY；若浏览器/页面异常崩溃，则 server 侧 lease/TTL 必须在宽限期后清掉孤儿 shell runtime。

测试层面至少需要四层证据。第一，新增的 `apps/server/tests/pty-websocket.test.ts` 与改写后的 PTY server 测试必须证明 session/profile cleanup 仍旧生效，WebSocket output/input/resize 正常，generic shell 的 lease cleanup 可验证。第二，`apps/web` typecheck 和 build 必须通过，确保 channel adapter、URL helper 与视图切换没有引入新的类型错误。第三，新增的 E2E 场景必须证明用户确实能打开 chat terminal、输入命令、看到结果、重连后继续使用，并能关闭 shell panel 让 scratch shell 退出。第四，`apps/server` build 与 repo 级 `pnpm typecheck` 需要通过，说明 server/web/desktop 共同消费下没有坏掉的共享契约。

## Idempotence and Recovery

本计划应按可重复执行设计。新引入的 WebSocket route、timeline、channel adapter 和测试文件都应是加法式落地；但因为本次明确采用 breaking cutover，所以不会保留旧 SSE route 作为运行时 fallback。回滚方式来自版本控制而不是兼容分支：若 WebSocket 迁移中途发现协议设计有误，应回退整个 cutover 提交，而不是在代码里继续养着第二套 transport。

若某次实施停在中间态，恢复策略也必须简单。因为没有兼容层，server 与 web 的 WebSocket 路径应在同一个短窗口内一起落地并一起验证，避免半迁移状态长期存在。任何时候都不得把 chat session/profile cleanup 逻辑放到前端或 transport close 中，否则回滚后会出现 owner 漂移。另一方面，generic shell 的 cleanup 恰恰必须由 panel owner 主动发起，并由 server lease/TTL 在异常断连后兜底；这两套 owner 语义不能混写。

## Artifacts and Notes

本计划实施时应在本节补充关键证据，尤其是这些小型片段：

    WebSocket 首帧示例
    {"type":"snapshot","seq":42,"buffer":"...","running":true}

    增量输出示例
    {"type":"output","seq":43,"data":"echo cradle-ws-test\\r\\n"}

    退出事件示例
    {"type":"exit","seq":44,"exitCode":0,"signal":null}

    目标 E2E 观察点
    - 打开 chat tab 后可见 xterm 内容
    - 输入命令后在终端中看见唯一一次输出
    - 刷新或 remount 后 server 日志无 crash
    - 删除 session 后 chat terminal 显示一次 `[Process exited]`
    - 关闭 shell panel 后 scratch shell 退出且不残留孤儿 runtime

实施过程中若出现协议调整、snapshot 退化、shell path 单独拆分等变化，必须把最小日志、测试输出或 diff 摘要贴回本节，方便下一位执行者从这份计划单独恢复上下文。

## Interfaces and Dependencies

`apps/server/src/modules/pty/` 在实施完成后必须至少显式存在以下职责边界。

在 `apps/server/src/modules/pty/service.ts` 中继续暴露资源语义函数，例如：

    startOrAttach(input: { sessionId: string; cols: number; rows: number }): { sessionId: string; running: boolean }
    stop(sessionId: string): void
    shellStart(input: { ptyId: string; cwd: string; cols: number; rows: number }): { ptyId: string; running: boolean }

在新的 runtime/timeline 层中，至少要有能够表达这些职责的接口或等价 plain functions：

    interface PtyRuntimeRegistry {
      ensureSession(input: { sessionId: string; executable: string; args: string[]; cwd: string; cols: number; rows: number; env?: Record<string, string> }): void
      write(sessionId: string, data: string): boolean
      resize(sessionId: string, cols: number, rows: number): boolean
      destroy(sessionId: string): void
      hasSession(sessionId: string): boolean
      isRunning(sessionId: string): boolean
    }

    interface PtyTimelineStore {
      appendOutput(sessionId: string, data: string): number
      appendExit(sessionId: string, exit: { exitCode: number | null; signal: string | null }): number
      snapshot(sessionId: string): { seq: number; buffer: string; running: boolean; exit?: { exitCode: number | null; signal: string | null } }
      since(sessionId: string, fromSeq: number): { ok: true; events: PtyServerEvent[] } | { ok: false; snapshot: PtySnapshotEvent }
    }

`apps/server/src/modules/pty/pty.socket.ts` 或等价模块必须定义明确的 live channel 消息边界。建议的 client -> server 消息为：

    type PtyClientEvent =
      | { type: 'input'; data: string }
      | { type: 'resize'; cols: number; rows: number }
      | { type: 'ping' }

建议的 server -> client 消息为：

    type PtyServerEvent =
      | { type: 'snapshot'; seq: number; buffer: string; running: boolean }
      | { type: 'output'; seq: number; data: string }
      | { type: 'exit'; seq: number; exitCode: number | null; signal: string | null }
      | { type: 'pong' }
      | { type: 'error'; code: string; message: string }

  type PtySnapshotEvent = Extract<PtyServerEvent, { type: 'snapshot' }>

`apps/web/src/features/tui/pty-channel.ts` 或等价模块必须把 transport 状态与 xterm UI 解耦。该 adapter 至少需要接收 `sessionId`、可选 `fromSeq`、`onSnapshot`、`onOutput`、`onExit`、`onError` 回调，并提供 `sendInput()`、`sendResize()`、`close()`。`TuiView` 与 `ShellView` 只能消费这个 adapter，而不能各自复制 socket state machine。

generic shell 的 owner 语义也必须在接口层显式写出。chat terminal 继续依赖 `SessionService.onSessionCleanup()` 和 profile 删除链路；shell terminal 则需要一条明确的 panel-owned stop path。下文中的 shell route path 参数一律命名为 `ptyId`，以避免与 chat session 的 `sessionId` 混淆。相关接口例如：

  shellStop(ptyId: string): void
  scheduleShellLeaseExpiry(ptyId: string): void
  cancelShellLeaseExpiry(ptyId: string): void

`ShellView` 卸载时必须触发 `shellStop(ptyId)`；若视图异常中断未触发 cleanup，server 侧 lease 到期后必须 `destroy(ptyId)`。

测试依赖和路径也必须明确。`apps/server/tests/pty-websocket.test.ts` 应启动真实 Node adapter listener；`app.handle()` 仍只用于 HTTP/SSE 路径；E2E 使用 `e2e/src/support/server-lifecycle.ts` 托管的 managed server/web，不要求虚构根级 `pnpm build`。若后续为了提升 WebSocket 测试可维护性而新增依赖，必须在 `apps/server/package.json` 中显式安装并记录用途。

依赖方面，本计划不引入新的全仓库 transport 框架；server 继续使用 Elysia 提供的 route 能力和现有 `node-pty`；web 继续使用浏览器原生 WebSocket 与 xterm.js；session/profile/workspace 解析继续由 `apps/server/src/modules/session/`、`profiles/`、`db` 与 `workspace` owner 提供。若实施中证明需要为 WebSocket 协议新增 workspace package，必须在 `Decision Log` 中单独登记原因，而不是默认扩容范围。

Revision note (2026-05-15): Initial draft created after PTY crash investigation, protocol decision, and multi-work decomposition. This revision intentionally supersedes the earlier PTY=SSE assumption for this capability only, while keeping HTTP as the owner of terminal resource lifecycle.