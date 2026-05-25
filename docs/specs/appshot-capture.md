<!--
Input: Codex.app Computer Use helper evidence, Cradle Mac Bridge implementation, and Appshot strategy requirements.
Output: Appshot capture strategy and verification spec.
Position: docs/specs/appshot-capture.md
-->

# Appshot Capture

## 目标

Cradle 的 Appshot capture 必须同时满足两个方向：

- `cradle-native` 是 Cradle-owned 的正式能力，负责截图、原生动效、声音、metadata 和后续 composer/slash command 接入。
- `codex-private` 是研究和兼容 adapter，负责调用 Codex Computer Use helper 的私有 Apple Event 回传链路，用于验证、对照和临时复用 Codex Appshot 行为。

这两个方向共享同一个 Appshot capture session 语义，但 owner 不同。Cradle 可以读取 Codex helper 的私有回传；Cradle 不写 Codex namespace，不把 Codex 私有协议作为稳定产品协议。

## Codex 证据

从解包的 Codex Computer Use helper 里确认到：

- helper bundle id 是 `com.openai.sky.CUAService`。
- worker 到 helper 的 Apple Event bridge 使用：
  - event class `SkCu`
  - event id `SndR`
  - request type keyword `RspT`
  - request data keyword `ReqD`
  - client version keyword `ClVn`
  - client version `CodexComputerUseNativeBridge-1`
- request types：
  - `ComputerUseIPCAppStartCaptureRequest`
  - `ComputerUseIPCAppNextCaptureUpdateRequest`
- update types：
  - `metadata`
  - `axText`
  - `screenshot`
  - `completed`
  - `failed`
- helper links `ScreenCaptureKit`, `AppKit`, `QuartzCore`, `ApplicationServices`, and `AudioToolbox`.
- Appshot transition symbols include `AppshotCaptureTransition`, `AppshotCaptureTransitionOverlayWindow`, `transitionBackgroundLayer`, `destinationShadowLayer`, `keyShadowLayer`, `ambientShadowLayer`, `destinationShadowMaskLayer`, `keyShadowMaskLayer`, `ambientShadowMaskLayer`, `shutterLayer`, `snapshotEffectsLayer`, `snapshotImageLayer`, `snapshotMaskLayer`, `snapshotMaskDebugLayer`, `magicMove`, `appshotShutterFadeIn`, `appshotShutterFadeOut`, `appshotSnapshotFadeIn`, `appshotMagicMoveFadeDuration`, `appshotAppIconFadeIn`, and `appshotTitleFadeIn`.
- Appshot sound resource is `Package_Appshot.bundle/Contents/Resources/Appshot.wav`.
- Codex web sends an `animationDestination` object derived from the composer UI, not from the frontmost window. The object contains `viewportFrame`, `backgroundColor`, `cornerRadius`, `primaryTextColor`, and optional `transitionSnapshotScale`.
- Codex web divides the helper-returned `transitionSnapshotHeight` by `transitionSnapshotScale` before using it as UI-space height.

### Private Apple Event Authorization

Runtime probing on 2026-05-25 added one more constraint:

- `SkyComputerUseService` can be launched and discovered as `com.openai.sky.CUAService`.
- Cradle's Swift adapter sends the same observed Apple Event constants and request shape as Codex worker:
  - target descriptor: kernel process id
  - event class/id: `SkCu` / `SndR`
  - params: `RspT`, `ReqD`, `ClVn`
  - data descriptor types: `tdta` and `utf8`
  - request shape: `{ "animationTarget": ..., "app": ..., "requestId": ... }`
- Direct calls from the current development terminal reach `SkyComputerUseService`, but both `ComputerUseIPCAppStartCaptureRequest` and `ComputerUseIPCAppNextCaptureUpdateRequest` time out with `NSOSStatusErrorDomain` code `-1712`.
- macOS unified logs show the service enters `TCCAccessRequestIndirect` while handling the request. The target identity is the responsible sender process, for example `com.mitchellh.ghostty`.
- The helper binary contains sender authorization strings such as `senderAuthorization`, `responsibleProcessIsCodex`, `allowedRelayRequirement`, and a Codex/OpenAI bundle allowlist including `com.openai.codex`, `com.openai.codex.alpha`, `com.openai.codex.beta`, `com.openai.codex.nightly`, `com.openai.chat.*`, and `com.openai.atlas.*`.
- Runtime report `docs/manual-reports/2026-05-24T20-21-08-113Z-appshot-parity/README.md` captures the helper-running failure case: `Service running: true`, service process id `20815`, direct status `failed`, and `NSOSStatusErrorDomain` code `-1712` for `ComputerUseIPCAppStartCaptureRequest`.

This means the private callback path is not just a stable Apple Event schema. It is also gated by Codex Computer Use sender authorization. A Cradle-owned process should not assume it can call the private service directly with identical results, even if the Apple Event payload is byte-compatible.

## Strategy

### `cradle-native`

Owner: `apps/desktop/native/macos/mac-bridge`.

Responsibilities:

- Read the frontmost window.
- Apply Cradle privacy-sensitive capture rules.
- Prefer `ScreenCaptureKit` and `SCScreenshotManager` for window capture on macOS 14+.
- Fallback to `/usr/sbin/screencapture` when ScreenCaptureKit is unavailable or fails.
- Write PNG and metadata under Cradle-owned desktop storage.
- Present an AppKit/QuartzCore overlay with the Codex-observed layer vocabulary:
  - background fade
  - shutter fade
  - snapshot image fade
  - rounded snapshot mask
  - destination, key, and ambient shadow layers
  - magic-move frame animation
  - app icon fade
  - title fade
- Play Cradle-packaged `Resources/Appshot.wav`.

`cradle-native` keeps protocol coordinates and overlay coordinates separate. `animationTarget.destinationFrame`, `codexDisplay.bounds`, and frontmost window bounds remain top-left screen-space rectangles so they can be passed unchanged to Codex private bridge semantics and renderer IPC. The AppKit overlay converts source and destination rectangles into bottom-left `NSScreen` coordinates only inside the native transition presenter.

The magic-move source frame is the captured frontmost window bounds. The destination frame is renderer-owned when `/appshot` is triggered from the composer. Research paths that do not have renderer context synthesize a composer-like destination frame under `apps/desktop/src/main/native-appshot-target.ts` and `apps/desktop/scripts/record-appshot-parity.mjs`; they must not reuse the frontmost window bounds as the destination because that would make source and destination identical and hide transition geometry regressions.

The Codex binary evidence gives a reliable layer vocabulary and resource inventory, but it does not expose every numeric transition constant as a stable public contract. Cradle therefore owns a native `transitionStyle` calibration object for parity tuning. It can override fade progress points, opacity values, shadow parameters, accessory icon/title offsets, and completion delay without changing the Apple Event compatibility adapter. The style is serialized in the native Appshot metadata and is accepted by `macCapture.captureAppshot`, `macCapture.captureAppshotParityProbe`, and `record:appshot-parity -- --transition-style <json-or-file>`.

`cradle-native` is the default production path for both Command hotkey and any future slash command panel attachment flow.

### `codex-private`

Owner: `apps/desktop/native/macos/mac-bridge/Sources/CradleMacBridge/CodexAppshotPrivateAdapter.swift`.

Responsibilities:

- Detect `com.openai.sky.CUAService`.
- Send the private Apple Event protocol with `CodexComputerUseNativeBridge-1`.
- Poll `ComputerUseIPCAppNextCaptureUpdateRequest`.
- Return Codex update records.
- Attach Cradle-owned `cradleTranscript` evidence to successful start/update replies and to native Apple Event send failures. The transcript records the request envelope, request payload, descriptor types, request/response byte counts, hashes, timing, parsed reply payload, and native send error metadata.
- In Electron main, resolve Codex file URL/path image updates only when they live under `/tmp/com.openai.sky.CUAService`.
- Expose local path and data URL for resolved screenshot and transition snapshot assets.

`codex-private` is intentionally strict. If the caller explicitly selects it and the helper/protocol is unavailable, Cradle should throw instead of silently pretending success. In `auto`, Cradle may fall back to `cradle-native`.

### Slash Command Attachment Flow

Owner: `apps/web/src/features/chat`.

The chat feature defines `/appshot` as a Cradle-owned UI slash command, not a runtime-native slash command. Runtime slash commands remain raw text passthrough because their semantics belong to the active chat runtime. `/appshot` measures the composer action target, maps it into Cradle's `animationTarget` shape, calls Electron main through `macCapture.captureAppshot({ strategy: "auto", sink: "file", animationTarget })`, converts the returned image asset to an AI SDK `FileUIPart`, and appends it to the current composer draft. If the selected model does not accept image attachments, the command is not shown.

The renderer-owned `animationTarget` is the Cradle equivalent of Codex web's `animationDestination`. The current Codex renderer bundle shows that Appshot targets an attachment-preview slot, not the whole composer card: the target width is `232 * devicePixelRatio`, height is `140 * devicePixelRatio`, the first slot starts after an `88 * devicePixelRatio` leading offset, subsequent slots advance by `240 * devicePixelRatio`, `cornerRadius` is `0`, and `transitionSnapshotScale` is the device pixel ratio. Cradle keeps `destinationFrame` as screen-space coordinates for the native bridge, while `transitionSnapshotScale` is used to normalize helper-returned `transitionSnapshotHeight` into overlay space. The native frontmost-window bounds are only a fallback for hotkeys and research scripts that do not have renderer UI context.

The slash command surface only consumes renderer-safe image data URLs returned by Electron main. It does not read Codex temp files directly and does not know whether the final capture came from `codex-private` or `cradle-native`.

### Parity Probe

Owner: `apps/desktop/src/main/native-services.ts`.

`macCapture.captureAppshotParityProbe` is a desktop research API for controlled comparison. It reads the frontmost context, chooses the renderer-provided `animationTarget` or synthesizes a composer-like destination, starts a Codex private capture, locks the Cradle-native source window to the initially observed `windowId` and `processId`, applies Codex-returned calibration values plus any caller-provided `transitionStyle` to a Cradle-native capture, and returns both results plus the actual animation target and calibration that were applied.

The companion `record:appshot-parity` script records evidence into `docs/manual-reports` and supports three Codex evidence sources:

- `direct`: sends the private Apple Event protocol to `com.openai.sky.CUAService`. This is the strict protocol compatibility diagnostic path.
- `observe`: does not send Apple Events. It snapshots `/tmp/com.openai.sky.CUAService`, waits while the operator triggers Codex AppShot from Codex UI, then copies newly written image assets into Cradle-owned report storage. When `--record-video` is enabled, the recorder starts Cradle-owned display recording before printing the trigger prompt and saves the observation window as `codex-observed-appshot.mov`.
- `direct-and-observe`: runs both paths in one report. This is useful when direct Apple Event calls hit sender authorization timeouts but Codex UI can still produce temp assets.

The observer path exists because Codex Computer Use applies sender authorization in addition to the Apple Event schema. It preserves namespace ownership: Cradle reads Codex-owned temp assets and copies evidence into Cradle-owned reports, but it never writes into `/tmp/com.openai.sky.CUAService`. Direct private Apple Event reports also include `codex.direct.transcripts`: this is Cradle-owned interception evidence for the request/reply envelope and native error surface, not a field owned by Codex's protocol.

The recorder emits hashes and image dimensions for copied Codex and Cradle assets. It also compares every copied Codex image against every copied Cradle image: dimensions and hashes are always reported, and SSIM/PSNR are computed with `ffmpeg` when the image dimensions match. The recorder can optionally capture videos, extract frames with `ffmpeg`, emit video metadata, frame counts, and first/last frame hashes, then compare paired Codex/Cradle frames by index. `--recording-backend auto` tries the Cradle-owned ScreenCaptureKit window-discovery recorder first, then the Mac Bridge display recorder, then `/usr/sbin/screencapture`, then an FFmpeg AVFoundation screen device when one is exposed. The window-discovery recorder exposes two-phase `mac.recording.startWindow` / `mac.recording.finishWindow` methods and can wait for a newly appearing Appshot overlay by process id, bundle identifier, explicit window id, and display bounds. The Mac Bridge display recorder exposes two-phase `mac.recording.startDisplay` / `mac.recording.finishDisplay` methods so video capture is active before Appshot is triggered. It prefers ScreenCaptureKit and records its actual backend, including `core-graphics-window-list-polling` when ScreenCaptureKit cannot enumerate displays. Backend attempts are recorded under each recording as `recordingAttempts`, and a backend that fails before the Appshot trigger is treated as recorder evidence failure rather than as Codex or Cradle Appshot failure. A window recorder that discovers the overlay but receives no stream frames fails with `screen-window-recording-empty`; this is evidence that ScreenCaptureKit selected a candidate but did not produce visual proof, not evidence of visual parity. Raw recording files are preserved unchanged under the report's `recordings` directory. When both recordings are usable, the report records a `comparisonWindow` whose duration is the shorter raw recording duration; frame extraction and whole-video SSIM/PSNR use that normalized window to exclude recorder padding while keeping the original `.mov` files available for audit. In observe mode, the recorder snapshots Codex temp assets immediately before the prompt, polls for newly written assets until `--observe-seconds` expires, and records the wait result under `codex.observe.wait`; when display recording is enabled, the raw video still covers the full observe window even if asset detection returns early. Before any Cradle-native primary or sweep capture, the recorder passes the initial context as `targetWindow` and records `targetLock` with the requested source window and the actual captured source window. `--require-proven-parity` requires this target lock to match, because operator interaction with Codex UI can change the frontmost application between the Codex observation window and the Cradle replay. The report also records `codex.appshotEvidence`, which must prove that Codex AppShot actually occurred through a successful direct start/update, direct copied assets, or newly observed Codex temp assets. A static observe recording with no Codex AppShot evidence is never enough, even when its decoded frames match Cradle. Extracted decoded PNG frames are the pixel-perfect gate because they remove H.264 container and encoder differences from the assertion. In observe mode the operator-triggered Codex clip can have arbitrary leading idle frames, so the recorder detects each transition start from adjacent-frame SSIM changes, records `transitionFrameAlignment`, and compares the aligned transition window for the hard frame hash gate. The raw frame comparison is still kept as diagnostic evidence. When paired frames have matching dimensions but different hashes, the recorder writes visual difference PNGs under `frames/diff-raw` or `frames/diff-aligned` and stores their paths on each frame comparison entry, so native transition calibration can inspect geometry, opacity, shadow, and timing errors directly. Whole-video SSIM/PSNR remains diagnostic evidence that the raw recordings can be compared over the same window, but it is not the hard pixel-perfect predicate. Extracted frame evidence is written for every available video even when the opposite side is missing; paired comparison still requires both Codex and Cradle frames. In observe mode, paired video/frame comparisons are only meaningful if the operator actually triggered Codex UI AppShot inside the recorded observation window. Full per-frame metrics live in `report.json`; the Markdown report summarizes alignment status, compared frames, unmatched frames, exact hash matches, written diff artifacts, dimension mismatches, metric failures, mean SSIM/PSNR, and worst SSIM/PSNR frames.

The report also includes two Cradle-native transition probes because external macOS recording paths can fail independently from the AppKit overlay. `mac.appshot.probeTransitionVisibility` shows a long-lived Appshot panel and records whether CoreGraphics can enumerate the overlay window plus whether `CGWindowListCreateImage` can produce external proof frames. `mac.appshot.probeTransitionPresentation` samples the same Core Animation layer tree from inside the native presenter, writes Cradle-owned presentation PNGs, and records snapshot frame and opacity changes. Runtime report `docs/manual-reports/2026-05-24T23-50-07-235Z-appshot-parity/report.json` demonstrates why both are needed on the current machine: ScreenCaptureKit is available but returns `displayCount: 0`, the visibility probe finds the overlay panel in CoreGraphics 15/15 times but writes zero images, while the presentation probe writes 18 images, observes 6 unique image hashes, records snapshot/opacity changes, and sets `motionDetected: true`. This proves the native overlay is moving while the current external recorder cannot prove it visually. It does not relax the pixel-perfect gate: `parityStatus.provenPixelPerfect` remains false until Codex UI occurrence, aligned comparable frames, whole-video diagnostics, static assets, and Cradle recording visibility are all present.

Runtime report `docs/manual-reports/2026-05-25T00-21-41-904Z-appshot-parity/report.json` adds evidence for the ScreenCaptureKit window-discovery backend on the same machine. ScreenCaptureKit still reports `displayCount: 0`, but the window backend discovers the Cradle overlay window as `windowId: 239307` for bridge process `16944`; the stream then delivers zero frames and the recorder fails with `screen-window-recording-empty`. This narrows the recorder gap to ScreenCaptureKit frame delivery for the selected overlay window. It still does not satisfy the Cradle recording visibility gate.

The same report compares Codex's original `Package_Appshot.bundle/Contents/Resources/Appshot.wav` with the Cradle-packaged `Appshot.wav` by size, sha256, and `ffprobe` audio metadata. The `--transition-style <json-or-file>` flag passes a Cradle-owned transition calibration object into the native capture and records it under `appliedCalibration.transitionStyle`, so a visual parity run can be reproduced without editing Swift. The `--transition-style-sweep <json-or-file>` flag captures multiple Cradle-native calibration variants under the same frontmost context and animation target. When `--record-video`, `--extract-frames`, or `--analyze-video` are enabled, every sweep variant also records its own transition video, normalized comparison window, extracted frames, Codex video comparison, and Codex frame comparison. Sweep variants are calibration evidence only; they do not participate in `parityStatus.provenPixelPerfect` until one selected style is promoted into the primary capture path and the executable parity gate passes. The `--require-proven-parity` flag turns the report into an executable gate: it writes all evidence first, then exits non-zero unless `parityStatus.provenPixelPerfect` is true.

This API exists to produce parity evidence and tune the Cradle-native transition. It is not the product default and should not make Codex private protocol compatibility a Cradle-owned stable contract.

## Strategy Selection

Use:

- `cradle-native` for product behavior, packaging, repeatability, and long-term ownership.
- `codex-private` for research, regression comparison, and validating parity against Codex helper behavior.
- `auto` for user-triggered capture: Electron main reads the frontmost context when needed, tries `codex-private` with the current `animationTarget` and bundle identifier, then falls back to `cradle-native` if Codex private capture is unavailable.

The reason is ownership: Codex owns its private protocol compatibility and migration. Cradle owns Cradle Appshot semantics and storage.

## Verification

Current implementation-level gates:

- Swift build for `cradle-mac-bridge`.
- Desktop main TypeScript typecheck.
- `mac-bridge-manager.test.ts` covers new NDJSON methods for `mac.appshot.captureFrontmostWindow` and `mac.codexAppshot.*`.
- `mac-bridge-manager.test.ts` also covers `mac.appshot.probeTransitionVisibility` and `mac.appshot.probeTransitionPresentation` so the report evidence methods stay schema-visible to Electron main.
- `native-services.test.ts` covers parity target synthesis so research probes do not silently fall back to source-equals-destination geometry.
- `chat-slash-commands.test.ts` covers Cradle-owned `/appshot` command registration.
- `composer.test.tsx` covers UI slash commands appending returned `FileUIPart` attachments and providing a renderer-derived animation target to the action callback.
- `build-mac-bridge.mjs` must produce `.build/cradle-dist/cradle-mac-bridge` and `.build/cradle-dist/resources/Appshot.wav`.
- `record:appshot-parity` must be used for runtime visual/audio parity evidence before declaring pixel parity.
- `record:appshot-parity -- --require-proven-parity` must fail until the report contains complete proof for every visual and audio parity gate.

Parity gates required before declaring `cradle-native` visually 100% same as Codex Appshot:

- Capture Codex Appshot and Cradle Appshot on the same frontmost window, display scale, theme, and destination frame.
- Record both transitions at the same frame rate.
- Compare:
  - sound resource duration and waveform identity
  - transition duration
  - shutter fade timing
  - snapshot fade timing
  - shadow radius, opacity, and offset
  - corner radius
  - app icon/title fade timing
  - final snapshot frame and mask geometry
  - transition snapshot output
- Keep the comparison artifact under a Cradle-owned research or manual report path.
- The sound comparison must show Codex and Cradle `Appshot.wav` as byte-identical.
- The executable parity gate must pass with `parityStatus.provenPixelPerfect: true`.

Until those runtime artifacts exist, the implementation is Codex-evidence-aligned, not yet proven pixel-perfect.
