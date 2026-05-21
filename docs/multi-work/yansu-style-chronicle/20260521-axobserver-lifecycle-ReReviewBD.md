# AXObserver Lifecycle ReReview BD

## Verdict

当前工作树是一个“daemon 持有的 AXObserver runtime foundation”，但还不能算真正可靠地完成 daemon-owned AXObserver lifecycle。

它确实在 `chronicle/src/daemon.rs` 中由 daemon 持有 `Option<AxObserverRuntime>`，只在 macOS provider 且 `ax_observer` enabled 时启动，并在 frontmost app 变化时 drop/restart。`AxObserverRuntime` 也确实创建 worker thread、bounded event queue、`AXObserverCreate`、`AXObserverAddNotification`、run loop source，并在 drop 时发送 stop 后 join worker。

阻塞点在于：runtime ready 语义、notification subscription 成功性、event-triggered capture 的 privacy 行为、backpressure 消化能力，以及文档对“已实现 lifecycle”的口径都比代码实际能力更强。

## Blocking Findings

1. **AXObserver 可以在没有任何有效 notification subscription 的情况下被标记为 started。**

   位置：`chronicle/src/screen/macos.rs:354`

   `AXObserverAddNotification` 的返回值被完全忽略，随后 `ready_tx.send(Ok(()))`。这意味着 target app 不支持这些 notification、权限被局部拒绝、element 不接受该 notification、或全部 add 失败时，daemon 仍会打印 `AXObserver started`，但 worker 实际不会产生事件。对 lifecycle 来说这不是小日志问题，而是 ready contract 不成立：daemon 无法区分“observer 已订阅”与“observer thread 空转”。

   建议修复方向：统计至少一个成功 subscription；如果全部失败，应返回 unavailable/error，或者把 supported/failed notification 列表作为 runtime status 暴露。

2. **privacy redaction evidence 的文档承诺与实际持久化路径不一致。**

   位置：`chronicle/src/screen/macos.rs:241`、`chronicle/src/daemon.rs:253`

   `read_ax_observer_accessibility_capture()` 在发现 private window 时会构造 `AXObserverPrivacyFilter` redacted accessibility payload。但随后 `process_ax_observer_events()` 把它传入 `capture_macos_with_accessibility()`；后者进入 `MacosCaptureSource::capture_*_with_accessibility()` 后会再次调用 window inventory 与 privacy filter。如果仍有 private window，source 直接返回空 frames，导致 redacted accessibility payload 不会落盘、不会上报。

   因此 SynthesisBC 中“sensitive windows return redacted macos-ax-observer evidence instead of reading titles/values”的说法目前最多是内存中构造过 payload，不代表 Chronicle artifacts 或 Server ingest 可见。实际结果更可能是整帧被丢弃。

3. **event-triggered path 不是纯 AX lifecycle，它仍然触发完整屏幕截图、OCR 与 snapshot ingest。**

   位置：`chronicle/src/daemon.rs:253`

   每个 AX notification 都调用 `capture_macos_with_accessibility()`，也就是重新截屏、Vision OCR、写 frame artifacts、再上报 snapshot。AXObserver 只是触发器，不是独立 accessibility evidence lifecycle。高频 UI changes 会把原本低成本 AX event 转换成高成本 full-screen capture，带来隐私面扩大和 backpressure 放大。

   这不阻止 foundation 存在，但阻止把它描述成已经具备成熟的 AXObserver-owned event pipeline。

## Lifecycle Risks

1. **ready timeout 后仍返回 usable runtime。**

   位置：`chronicle/src/screen/macos.rs:189`

   `recv_timeout(2s)` 超时分支返回 `Ok(Self { ... })`，即使 worker 尚未成功添加 run loop source 或发送 ready。若 worker 卡在 AX API、AppKit/CoreFoundation 边界，daemon 会认为 observer 可用；后续 drop 会 join 该 worker，存在 shutdown 卡住风险。当前代码没有 worker health/status，也没有 join timeout。

2. **frontmost app 不可用时不会停止 stale observer。**

   位置：`chronicle/src/screen/macos.rs:221`

   `frontmost_target_changed()` 使用 `frontmost_application().is_some_and(...)`。当 `frontmost_application()` 返回 `None` 时结果是 `false`，daemon 会继续保留旧 target observer。更合理的生命周期语义是：无法确认 frontmost target 时标记 changed/unavailable，至少停止或重试 observer，而不是继续订阅旧 app。

3. **runtime rebuild 只跟随 frontmost app，不跟随 permission loss 或 notification capability drift。**

   位置：`chronicle/src/daemon.rs:221`

   Accessibility permission 在 daemon 运行期间被撤销时，现有 observer 不会被显式降级；notification add failures 也没有 status。下一次 AX tree read 可能 unavailable，但 observer lifecycle 自身仍显示 started。

## Privacy Risks

1. **privacy check 仍依赖 window inventory title/owner read。**

   位置：`chronicle/src/screen/macos.rs:244`、`chronicle/src/screen/macos.rs:559`

   event path 在读取 AX tree 前会检查 window inventory，这是好的；但 private window detection 本身已经读取了 visible window titles/owners。随后非 private 路径会读取 `AXTitle`、`AXDescription`、`AXHelp`、`AXIdentifier`、`AXValue`。这属于高敏 UI text 采集，当前没有 per-app allowlist、field-level redaction、元素级敏感过滤或 consent boundary。

2. **AX event target 与 screenshot privacy check 存在 TOCTOU。**

   位置：`chronicle/src/screen/macos.rs:241`、`chronicle/src/screen/macos.rs:78`

   `read_ax_observer_accessibility_capture()` 和后续 `capture_displays_with_accessibility()` 各自读取一次 window inventory。两次读取之间前台窗口可能变化，导致 AX tree 与 screenshot/window privacy decision 不对应。当前没有把 event target window id、timestamp 或 privacy decision 绑定到同一个 capture transaction。

## Backpressure Risks

1. **bounded queue 存在，但 consumer 侧吞吐远低于 producer 风险。**

   位置：`chronicle/src/screen/macos.rs:396`、`chronicle/src/daemon.rs:253`

   queue limit 是 256，daemon 每轮只 drain 4 个事件。每个事件又触发完整 capture/OCR/report，然后本轮还会继续做常规定时 capture。默认 poll interval 是 5s；在输入法、编辑器、浏览器频繁 value/title/focus changes 下，256 queue 很容易堆满。

2. **dropped count 是累计值，不是可操作的 per-window/per-period backpressure signal。**

   位置：`chronicle/src/screen/macos.rs:424`、`chronicle/src/screen/macos.rs:433`

   callback 把 `dropped_before` 设置为累计 `dropped_count`，queue full 时只递增全局计数。这个计数不会 reset，也没有按 notification/app/window 分类。只有成功入队后的后续事件才会携带 dropped marker；如果队列持续 full，Server 不会收到独立 backpressure record。

3. **没有 coalescing。**

   位置：`chronicle/src/screen/macos.rs:398`

   `AXValueChanged`、`AXSelectedTextChanged`、`AXTitleChanged` 等高频 notification 没有 debounce、coalesce key、latest-only policy 或 per-notification budget。当前策略会把大量相似事件排队，然后逐个触发昂贵 capture。

## Compile And Platform Risk

1. **当前 Rust 编译通过。**

   已运行：

   ```bash
   cargo check --manifest-path chronicle/Cargo.toml
   ```

   结果通过。因此本次没有确认到 Rust 语法或类型层面的阻塞编译错误。

2. **FFI 行为仍缺少平台验证。**

   位置：`chronicle/src/screen/macos.rs:366`

   `CFRunLoopRunInMode` 使用手写 `CFString::new("kCFRunLoopDefaultMode")`，而不是绑定 CoreFoundation 的 `kCFRunLoopDefaultMode` 常量。它能编译，但这里属于平台行为风险，应通过真实 macOS AX notification smoke test 验证：启动 daemon、切换 frontmost app、编辑文本、确认 callback 真的触发并落到 accessibility artifacts。

3. **notification constants 没有使用 ApplicationServices 常量。**

   位置：`chronicle/src/screen/macos.rs:398`

   当前 notification 名称是手写字符串。拼写通常是这些 CFString 常量的实际值，但没有类型/链接层保护。结合 `AXObserverAddNotification` 返回值被忽略，会让拼写或 unsupported notification 静默退化成“启动成功但无事件”。

## Documentation Overclaims

1. **SynthesisBC 说 privacy-sensitive windows return redacted evidence。**

   位置：`docs/multi-work/yansu-style-chronicle/20260521-axobserver-lifecycle-SynthesisBC.md`

   如上所述，redacted payload 会被后续 capture privacy filter 丢掉，不能确认 artifacts/Server 可见。应改成：private windows suppress event-triggered snapshot persistence；redacted AXObserver marker currently is not guaranteed to be persisted.

2. **`chronicle/src/README.md` 把 AXObserver notification-triggered capture lifecycle 与已有能力并列。**

   位置：`chronicle/src/README.md:61`、`chronicle/src/README.md:66`

   这会让读者以为 lifecycle 已稳定可用。更准确的说法应是 experimental/foundation：daemon can start a frontmost-app AXObserver and use notifications as capture triggers, but subscription success, coalescing, standalone evidence, and robust privacy status are not complete.

3. **Server README 暗示 AX tree 读取失败会降级为 window inventory evidence。**

   位置：`apps/server/src/modules/chronicle/README.md:28`

   event-triggered path 中 `read_ax_observer_accessibility_capture()` 对 AX tree 读取失败返回 `AccessibilityCapture::unavailable("macos-ax-observer")`，不是 window inventory evidence。polling path 才会 fallback 到 windows。这里需要区分 provider path。

4. **Web README 的 UI 说明基本可接受，但缺少 experimental caveat。**

   位置：`apps/web/src/features/chronicle/README.md:37`

   `macos-ax-observer` 的定义“表示 Rust AXObserver notification 触发了 AX tree capture”只在事件成功入队、被 daemon drain、capture 未被 privacy filter 丢弃、artifact 成功写出后成立。建议补充“only for persisted evidence rows”或避免让用户误解为所有 AX notifications 都会被记录。

## Recommended Verification

- 增加 macOS 手工 smoke：启动 daemon 后在 TextEdit/浏览器输入文本，观察是否出现 `macos-ax-observer` accessibility artifact，并确认不是只有 `macos-ax-tree-poll`。
- 在 unsupported app 或权限撤销场景验证 `AXObserverAddNotification` failure 是否被显式报告。
- 构造 private window 前台场景，确认 event path 是“完全不落盘”还是“redacted evidence 落盘”；当前代码倾向前者。
- 高频输入 30 秒，观察 queue drops、CPU、artifact 写入量和 Server ingest 延迟。

## Final Assessment

这轮实现已经从“轮询 helper”推进到“daemon 持有 AXObserver runtime”，但还没有达到可以称为完整 daemon-owned AXObserver lifecycle 的质量线。最需要先修的是 subscription ready contract、privacy/redaction 持久化语义、event coalescing/backpressure，以及文档口径收敛。
