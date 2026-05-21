# AXObserver Lifecycle ReReview BF

## Verdict

当前工作树已经处理 `20260521-axobserver-lifecycle-ReReviewBD.md` 中的主要阻塞项，可以把这轮改动称为 daemon-owned AXObserver lifecycle foundation。

本轮没有发现新的必须阻塞合入的代码级问题。需要保留的边界是：AXObserver event 仍然只是触发既有 screenshot/OCR/snapshot/accessibility 持久化路径；backpressure/coalescing 只是小批量 drain 内去重，不是完整 event-stream 压缩；startup timeout 不再返回可用 runtime handle，但 timeout 前卡住的 worker 仍只能依赖 channel disconnect 或进程退出自然回收。

## ReReviewBD Blocking Item Status

1. **`AXObserverAddNotification` subscription ready contract: Pass.**

   位置：`chronicle/src/screen/macos.rs:359`、`chronicle/src/screen/macos.rs:377`、`chronicle/src/screen/macos.rs:395`

   当前实现会统计 `AXObserverAddNotification` 成功和失败结果。若没有任何 notification 订阅成功，worker 会释放 `refcon`、`observer`、`app_element` 并通过 ready channel 返回 error。只有至少一个 subscription 成功并把 run loop source 加入当前 run loop 后，才发送 `Ok(())`。

2. **privacy/redaction persistence wording: Pass, with implementation boundary retained.**

   位置：`chronicle/src/screen/macos.rs:245`、`chronicle/src/screen/macos.rs:92`、`chronicle/src/daemon.rs:253`

   代码仍然会在 private window 场景构造 `AXObserverPrivacyFilter` redacted accessibility payload，但随后 `capture_macos_with_accessibility()` 进入 `MacosCaptureSource::capture_*_with_accessibility()`，会再次执行 window privacy filter；命中 private window 时返回 empty frames，因此该 redacted marker 通常不会持久化或上报。

   这与 FixBE 后的文档口径一致：private-window event handling 被描述为 suppressing event-triggered capture，而不是保证 redacted evidence 落盘。因此 BD 的“文档承诺与实际持久化不一致”已处理。

3. **event-triggered full screenshot/OCR/snapshot boundary: Pass.**

   位置：`chronicle/src/daemon.rs:253`、`chronicle/src/daemon.rs:313`、`chronicle/src/screen/macos.rs:87`

   event path 仍然对每个 drained event 调用 `capture_macos_with_accessibility()`，会重新走 display capture、Vision OCR、artifact write 和 `/chronicle/snapshots` report。FixBE、SynthesisBC、`chronicle/src/README.md` 与 Server README 都把它表述为 existing snapshot/accessibility contract 或 notification-triggered capture foundation，没有再宣称 standalone low-cost AX event history pipeline。

4. **startup timeout: Pass for ready contract, residual lifecycle risk.**

   位置：`chronicle/src/screen/macos.rs:198`

   `recv_timeout` 超时分支现在返回 `Err(Process(...))`，不会再返回 usable `AxObserverRuntime`。这修复了 BD 中“daemon 误认为 observer 可用”的阻塞点。

   残留风险：超时分支没有显式发送 stop 或 join worker；`command_tx` 随函数返回 drop 后，worker 如果已经进入 loop 会通过 disconnected channel 退出。但如果 worker 卡在 ready 前的 AX/CoreFoundation 调用中，thread 仍可能 detached 运行到进程退出。这不是原阻塞点，但建议后续用 startup cancellation 或 join timeout 改善。

5. **frontmost `None` / stale observer: Pass.**

   位置：`chronicle/src/screen/macos.rs:225`、`chronicle/src/daemon.rs:227`

   `frontmost_target_changed()` 现在使用 `is_none_or(...)`，frontmost lookup 失败会被视为 target changed。daemon 会 drop 旧 observer 并尝试重启，不会继续信任 stale frontmost observer。

6. **backpressure/coalescing: Partial Pass.**

   位置：`chronicle/src/screen/macos.rs:166`、`chronicle/src/screen/macos.rs:416`、`chronicle/src/screen/macos.rs:451`、`chronicle/src/daemon.rs:253`

   已有 bounded queue、full queue drop counter，以及 drain 内按 `pid + bundle + notification` 去重。相比 BD 的“没有 coalescing”，这已经补上基础机制。

   但当前 `drain(4)` 只在本次读取窗口内去重，并在收集到 4 个 unique events 后停止；queue 中更靠后的重复事件不会被清空或合并，下一轮仍可能触发昂贵 screenshot/OCR。`dropped_count` 也仍是累计计数，只会随成功入队事件进入 evidence。对 foundation 可接受，但还不是高频 AX event storm 下的强 backpressure 策略。

7. **README/Synthesis overclaim: Pass, with minor wording caveat.**

   位置：`docs/multi-work/yansu-style-chronicle/20260521-axobserver-lifecycle-SynthesisBC.md:50`、`docs/multi-work/yansu-style-chronicle/20260521-axobserver-lifecycle-SynthesisBC.md:53`、`chronicle/src/README.md:61`、`chronicle/src/README.md:66`、`apps/server/src/modules/chronicle/README.md:28`、`apps/web/src/features/chronicle/README.md:37`

   README 和 Synthesis 现在明确使用 `foundation`、`existing snapshot/accessibility contract`、`not standalone event history` 等限定语。Server README 也区分 polling path fallback 与 observer event path unavailable/suppression。整体不再过度宣称成熟 AX event pipeline。

   小 caveat：SynthesisBC 中 “turns each event into `macos-ax-observer` accessibility evidence” 这句话单独看仍偏强；结合后面的 known boundaries 可以接受。若后续再编辑文档，建议改成 “turns drained, persisted notification-triggered captures into ... evidence”。

## Additional Findings

1. **Medium: timeout branch can leave a pre-ready worker detached.**

   位置：`chronicle/src/screen/macos.rs:198`

   超时不再返回 runtime，这是正确的；但 worker handle 在 timeout 分支被 drop，没有 stop/join path。正常情况下 `command_tx` drop 会让 loop 退出；异常情况下，如果 worker 卡在发送 ready 之前，daemon 后续无法观测或停止它。

   建议后续：让 worker 在所有 pre-ready 阶段可取消，或在 timeout 分支发送 stop 并使用 bounded join strategy。Rust 标准库没有 safe join timeout，可能需要把 startup work 拆短、增加 progress state，或接受 process-level cleanup。

2. **Medium: coalescing scope is smaller than documentation wording might imply.**

   位置：`chronicle/src/screen/macos.rs:166`、`chronicle/src/daemon.rs:253`

   `drain(4)` 的去重只覆盖当前 drain loop 读取到的 events。它不会把整个 pending queue 压缩成 latest-only state，也不会丢弃同 key 的旧事件直到 queue empty。因此在连续 text change/title change 场景，重复 notification 仍可能跨 daemon loop 触发多次 full capture。

   这不阻塞 foundation，但如果目标是 production backpressure，需要把 queue 从 FIFO event list 改成 keyed pending map，或在 drain 时继续读到 empty 并只返回每个 key 的最新事件，同时保留 per-period dropped/coalesced metrics。

## Verification

已运行：

```bash
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo check --manifest-path chronicle/Cargo.toml
git diff --check -- chronicle/src/screen/macos.rs chronicle/src/daemon.rs chronicle/src/config.rs chronicle/src/README.md chronicle/src/screen/README.md apps/server/src/modules/chronicle/README.md apps/web/src/features/chronicle/README.md docs/multi-work/yansu-style-chronicle/20260521-axobserver-lifecycle-FixBE.md docs/multi-work/yansu-style-chronicle/20260521-axobserver-lifecycle-SynthesisBC.md
```

结果均通过。

未运行真实 macOS AX smoke。仍建议在授权 Accessibility 与 Screen Recording 的机器上验证：TextEdit/browser 输入、frontmost app 切换、private window 前台、权限撤销、高频输入 30 秒，确认 `macos-ax-observer` artifact、drop/coalescing 行为、private suppression 和 observer rebuild 日志符合预期。

## Final Assessment

FixBE 后，BD 的阻塞项已基本闭环。当前实现应该按 “AXObserver notification-triggered capture foundation” 进入下一阶段，而不是被描述为 standalone AX event history runtime。后续最值得单独开 slice 的方向是 keyed backpressure/coalescing、startup cancellation/health status，以及把 AX notification history 从 screenshot/OCR snapshot path 中拆出来。
