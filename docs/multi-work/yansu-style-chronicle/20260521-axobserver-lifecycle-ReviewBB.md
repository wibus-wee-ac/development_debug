# AXObserver Lifecycle ReviewBB

Input: Yansu AXObserver requirements, current Chronicle macOS capture/runtime code, Chronicle README notes, and prior accessibility/AX tree multi-work records.
Output: Independent review of what still blocks a real AXObserver notification lifecycle.
Position: Multi-work review artifact for the Yansu-style Chronicle AXObserver slice.

## 直接结论

当前 Chronicle 已经有 `macos-ax-tree-poll` 证据链：每次 screen capture 前读取 window inventory，隐私过滤通过后轮询 frontmost app 的 AX tree，并把 accessibility evidence 写入本地 artifact 和 snapshot report。这个能力对“结构化 UI evidence”有价值，但还没有解除 `AXObserver notification lifecycle` 的阻塞。

真正的 unblock 需要一个由 daemon 拥有的长生命周期 macOS observer runtime：创建 observer、注册 notification、把 run loop source 接入可持续运行的线程/loop、把 callback 转成 Chronicle-owned event evidence、处理目标 app/window 的增删与权限/错误状态，并在 idle、shutdown、app exit、permission change 时明确 teardown。仅继续扩展 polling、序列化字段或 snapshot payload，都会是伪完成。

## 当前实现事实

- `chronicle/src/screen/macos.rs:49` 的 macOS provider 是一次 capture 调用内的 pull model；`MacosCaptureSource` 只持有一批 `CapturedFrame`，没有常驻 observer 或 callback queue。
- `chronicle/src/screen/macos.rs:62` 在每批截图前调用 `read_accessibility_capture()`；`chronicle/src/screen/macos.rs:99` 轮询 `read_frontmost_ax_tree()`，provider 标记为 `macos-ax-tree-poll`。
- `chronicle/src/screen/macos.rs:137` 只使用 `AXUIElementCreateApplication` 和 `AXUIElementCopyAttributeValue` 读取 focused/main window/tree；代码里没有 `AXObserverCreate`、`AXObserverAddNotification`、`AXObserverGetRunLoopSource` 或 callback registration。
- `chronicle/src/daemon.rs:106` 的主 loop 由 timer、idle gate、screen capture 和 best-effort reporting 驱动；没有独立 AX event pump，也没有把 AX notification 作为唤醒或调度输入。
- `chronicle/src/screen/mod.rs:27` 的 `AccessibilityCapture` 是 snapshot-scoped data model，缺少 event identity、notification type、observed element identity、target pid、subscription state、sequence、delivery timestamp、drop/error reason 等 lifecycle 字段。
- `chronicle/src/recorder/artifacts.rs:80` 和 `chronicle/src/cradle_client.rs:85` 只持久化/上报 snapshot 附带的 accessibility tree；它们没有独立的 AX notification artifact 或 report contract。
- `chronicle/src/README.md` 已经把现状说清楚：当前有 AX tree polling accessibility evidence，但仍没有 AXObserver event subscription lifecycle。

## 阻塞项

### 1. 没有生命周期 owner

AXObserver 不能挂在 `MacosCaptureSource::capture_displays()` 这种一次性 capture helper 里。observer、run loop source、subscription registry、event queue 和 teardown 都需要一个明确 owner。按当前边界，最自然的 owner 应该在 daemon/macOS runtime 层，而不是 artifact store、server client 或 screen snapshot model。

推荐方向：

- 新增 macOS-only `AxNotificationRuntime` 或同等模块，由 daemon 创建、启动、轮询/接收事件、停止。
- daemon 持有 runtime handle，并在 shutdown、idle pause/resume、provider change 时调用明确的 lifecycle 方法。
- screen capture 可以读取 runtime 的最近 AX state 或 event buffer，但不拥有 observer lifecycle。

### 2. 没有 run loop integration

规格要求的关键步骤包括 `AXObserverCreate`、`AXObserverAddNotification` 和 `AXObserverGetRunLoopSource`。当前代码完全没有把 observer source 加到 `CFRunLoop`，也没有一个线程负责跑这个 run loop。

真正完成至少要回答：

- observer callback 跑在哪个线程；
- `CFRunLoopSourceRef` 如何 retain/release；
- callback 如何安全地把事件投递到 Rust-owned queue；
- daemon 停止时如何唤醒 run loop 并移除 source；
- panic/error 不会让 callback 跨 FFI unwind。

### 3. 没有 subscription lifecycle

只监听 frontmost app 一次不够。AX notification lifecycle 需要管理目标变化：

- 发现当前/新增 running application pid；
- 为每个 pid 创建或复用 observer；
- 对 app/root/window/focused element 注册 notification；
- app 退出、observer invalid、permission denied、notification unsupported 时注销并记录状态；
- frontmost app 切换、window created/destroyed、focused element changed 后更新订阅目标。

如果只对启动时 frontmost pid 注册一次，即使 callback 能触发，也不能算 unblock。

### 4. 没有 notification event contract

现有 `AccessibilityCapture` 表达的是“某个 snapshot 附带的树”。AXObserver 输出的是“某个时间发生了某类 UI 变化”。这两个东西可以关联，但不能混为一个 contract。

需要定义 Chronicle-owned event evidence，至少包含：

- stable `sourceId` / sequence；
- target `pid`、bundle id、optional window id；
- notification name，例如 focused element changed、window created、value changed；
- observed timestamp 和 ingest timestamp；
- element summary/tree excerpt；
- permission/error/drop status；
- related snapshot/artifact path 或 capture frame index；
- privacy filtering decision metadata。

没有这个 contract，server/web 只能看到 snapshot 的 accessibility payload，看不到 notification lifecycle。

### 5. 隐私边界必须前置到 event callback

上一轮 AX tree fix 已经把 privacy filter 放在 AX polling 之前，这是正确的。但 AXObserver callback 会绕过 screen capture 的正常入口，如果 callback 里直接读取 element title/value，就可能在本地内存或日志里捕获 private window 内容。

必须避免把“snapshot path 经过隐私过滤”误当成“AX notification 也安全”。AX event runtime 需要在读取敏感 attributes 前先做 app/window/title/url 层面的排除；无法判断时应降级为 redacted/drop，而不是继续读取 `AXValue`。

### 6. 没有 backpressure、dedup 和 drop semantics

`kAXValueChangedNotification` 可能非常频繁，尤其是文本输入、编辑器、浏览器地址栏和聊天窗口。当前 daemon 的 adaptive sampler 只处理 screenshot cadence，不处理 async AX event burst。

需要明确：

- bounded queue 大小；
- coalescing key，例如 pid + notification + element path；
- drop 策略和 drop count；
- 是否按时间窗与 snapshot 合并；
- 事件是否触发 immediate capture，还是只作为下一次 snapshot 的 evidence。

没有这些，第一次接入 callback 很容易造成 unbounded memory、日志噪音或 server report 风暴。

## 必须避免的伪完成

- 把 provider 从 `macos-ax-tree-poll` 改名成 `macos-axobserver`，但仍然只在截图周期里调用 `AXUIElementCopyAttributeValue`。
- 只添加 `AXObserverCreate` FFI declaration，未 retain observer、未注册 notification、未把 run loop source 加入运行中的 `CFRunLoop`。
- 只注册启动时 frontmost pid，app 切换、app 退出、window created 后不更新 subscription。
- callback 只打印日志，不写 Chronicle-owned artifact/report，也不进入 memory pipeline 可用的数据面。
- 把 AX notification 塞进现有 `AccessibilityCapture.text`，丢掉 notification type、target pid、sequence 和 error/drop state。
- 在 `CapturedFrame` 上增加字段，但没有 daemon-owned runtime；这样仍然是 snapshot polling，不是 notification lifecycle。
- 只做 server schema/API，不做 macOS callback/run loop；这只能证明 ingestion contract，不证明系统能监听 UI 变化。
- 只做单元测试序列化 JSON，不做至少一个 runtime-level lifecycle 测试 seam，例如 fake observer backend 的 start/register/callback/drop/stop。
- 把 permission denied 表示为空 tree + `ready`。当前 `PermissionDenied` status 已存在，AXObserver path 也必须保持显式状态。
- 在 callback 中读取 AX title/value 后再做隐私过滤。对于敏感窗口，这已经太晚。

## 建议的最小 unblock 标准

1. macOS-only AX notification runtime 有明确 public lifecycle：start、subscribe/update targets、drain events、stop。
2. runtime 创建 observer，注册至少 `kAXFocusedUIElementChangedNotification` 和 `kAXWindowCreatedNotification`；`kAXValueChangedNotification` 可以先 gated/limited。
3. observer run loop source 被加入专用 run loop，并能在 shutdown 时确定退出和 release。
4. callback 不跨 FFI unwind，不直接做重 IO；只采集最小安全 metadata 并投递 bounded queue。
5. event queue 有 bounded capacity、coalescing/drop counter 和 observable status。
6. AX event 有独立 artifact/report contract，或在 snapshot report 内有明确 `accessibilityEvents` 数组，不能只覆盖 latest tree。
7. privacy filter 在 callback attribute 读取前执行；无法确认 window/app 是否安全时 drop/redact。
8. daemon idle/shutdown 路径会暂停/停止 observer，不留下 run loop thread 或 dangling AX refs。
9. README/multi-work 明确区分三个层次：window inventory fallback、AX tree polling、AXObserver notification lifecycle。

## 验证建议

建议把测试分成两层：

- Unit seam: 用 fake AX backend 验证 start/register/callback/drain/drop/stop，不依赖真实 macOS permission。
- macOS manual smoke: 在 Accessibility permission granted 的机器上启动 daemon，切换 frontmost app、创建新窗口、改变文本值，确认 event artifact/report 中出现 notification type、pid/bundle、timestamp、drop count 和 privacy decision。

建议命令：

```bash
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path chronicle/Cargo.toml --lib
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
git diff --check -- chronicle/src docs/multi-work/yansu-style-chronicle
```

## 审查结论

AXObserver notification lifecycle 现在仍是阻塞状态。当前实现最多可以称为“AX tree polling evidence 已落地”，不能称为“AXObserver lifecycle 已 unblock”。下一步不应该继续围绕 snapshot payload 做局部补字段，而应该先建立 daemon-owned macOS observer runtime 和 Chronicle-owned event contract；否则实现会很容易在命名、payload 或测试层面显得完成，但运行时仍然没有可持续的 notification lifecycle。
