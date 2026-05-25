<!--
Input: Codex.app Computer Use helper evidence, Codex renderer bundle evidence, Cradle Mac Bridge implementation, and Appshot strategy requirements.
Output: Appshot capture strategy and verification spec.
Position: docs/specs/appshot-capture.md
-->

# Appshot Capture

## 目标

Cradle 的 Appshot capture 必须同时满足两个方向：

- `cradle-native` 是 Cradle-owned 的正式能力，负责截图、原生动效、声音、metadata 和 composer/slash command 接入。
- `codex-private` 是研究和兼容 adapter，负责调用 Codex Computer Use helper 的私有 Apple Event 回传链路，用于验证、对照和临时复用 Codex Appshot 行为。

这两个方向共享同一个 Appshot capture session 语义，但 owner 不同。Cradle 可以读取 Codex helper 的私有回传；Cradle 不写 Codex namespace，不把 Codex 私有协议作为稳定产品协议。

## Codex 分层证据

Codex Appshot 不是一个单层截图 API。解包证据显示它至少分成四层：

1. renderer capture orchestration
2. renderer attachment tray placeholder animation
3. native helper capture and overlay transition
4. private helper transport and update stream

后续实现必须保持这四层分离。尤其是 renderer 里的 pending attachment 动效不是 native Appshot overlay 动效，不能把它的 spring 参数当成原生 magic-move 参数。

### Renderer Orchestration

从 `app-asar-extracted/webview/assets/annotation-comment-editor-card-Doy_omTj.js` 可以确认：

- renderer 使用 `computer-use-start-capture` 发起捕获，请求参数是：
  - `animationDestination`
  - `bundleIdentifier`
  - `requestId`
- `animationDestination` 由 composer UI 计算，不来自 frontmost window。renderer 会把 UI 返回的目标对象拆成：
  - `viewportFrame`
  - `backgroundColor`
  - `cornerRadius`
  - `primaryTextColor`
- renderer 另外保留本地字段 `transitionSnapshotScale`，但不会把它传给 `computer-use-start-capture`。它只用于把 helper 返回的 `transitionSnapshotHeight` 从设备像素归一到 UI 坐标。
- renderer 监听 `window.message`，消息类型是 `computer-use-capture-updated`。
- update 类型包括：
  - `metadata`
  - `axText`
  - `screenshot`
  - `completed`
  - `failed`
- `metadata` 更新 `bundleIdentifier`，`axText` 更新可访问性文本，`screenshot` 更新 `screenshotDataURL` 或 `screenshotPath`。
- `completed` 之后 renderer 才把 `appshotContext` 加入 composer，字段包括：
  - `appName`
  - `windowTitle`
  - `bundleIdentifier`
  - `axTree`
  - `imageName`
  - `imageDataUrl`
  - `transitionSnapshotDataUrl`
  - `transitionSnapshotHeight`
  - `appIconDataUrl`

这说明 Codex renderer 的产品语义是“把当前 app/window 附加为一个 Appshot context”，不是单纯把截图作为普通 image attachment。

### Composer Target Geometry

从 `app-asar-extracted/webview/assets/composer-D0cvMZjq.js` 可以确认：

- Appshot 目标是 composer attachment tray 里的 attachment slot，不是整张 composer card。
- 目标 slot 的 UI 尺寸是 `232 x 140`，再乘以 `devicePixelRatio` 传给 native。
- 第一个 slot 的 leading offset 是 `88 * devicePixelRatio`。
- slot 间距是 `240 * devicePixelRatio`。
- 已有 image attachment 会占用 `88 * devicePixelRatio` 的步进。
- 已有 Appshot context 会占用 `240 * devicePixelRatio` 的步进。
- pending Appshot capture 自己也参与后续 slot 定位；renderer 会优先复用带 `data-pending-appshot-capture-request-id` 的 placeholder rect。
- `cornerRadius` 被设置为 `0`。
- `backgroundColor` 和 `primaryTextColor` 通过临时 DOM 节点从 composer 当前主题计算。
- 当 attachment tray 向上增长时，renderer 会用 app/window title 估算卡片高度，并从 y 坐标里扣除额外增长高度。

这部分是 renderer-owned geometry。Cradle 的 composer/slash command 应复刻这一层的目标计算，但不能把 frontmost window bounds 当作 destination，否则会掩盖 source-to-destination transition 的几何问题。

### Composer Placeholder Animation

从 `composer-D0cvMZjq.js` 可以确认 pending Appshot placeholder 是 Framer Motion 动效：

- placeholder DOM 带 `data-pending-appshot-capture-request-id` 和 `data-pending-appshot-capture`。
- 初始状态是：
  - `height: 0`
  - `width: 0`
  - `marginRight: -8`
- animate 状态是：
  - `height: transitionSnapshotHeight`
  - `width: 232`
  - `marginRight: 0`
- transition 是 spring：
  - `type: "spring"`
  - `visualDuration: transitionSpringResponse ?? 0.35`
  - `bounce: 1 - (transitionSpringDampingFraction ?? 0.73)`
  - `delay: 0.15`

这里的 `transitionSnapshotHeight`、`transitionSpringResponse`、`transitionSpringDampingFraction` 是 renderer attachment tray placeholder 的布局动效参数。它们不描述 native overlay 里的 shutter、snapshot fade、shadow 或 magic move。

### Native Helper Transition

从 `Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService` 的字符串可以确认：

- helper bundle id 是 `com.openai.sky.CUAService`。
- helper links `ScreenCaptureKit`, `AppKit`, `QuartzCore`, `ApplicationServices`, and `AudioToolbox`.
- native Appshot symbols include:
  - `AppshotCaptureTransition`
  - `AppshotCaptureTransitionOverlayWindow`
  - `transitionBackgroundLayer`
  - `shadowLayer`
  - `containerLayer`
  - `shutterLayer`
  - `snapshotEffectsLayer`
  - `snapshotImageLayer`
  - `snapshotMaskLayer`
  - `snapshotMaskDebugLayer`
  - `appIconLayer`
  - `titleLayer`
  - `magicMove`
  - `appshotShutterFadeIn`
  - `appshotShutterFadeOut`
  - `appshotSnapshotFadeIn`
  - `appshotMagicMoveFadeDuration`
  - `appshotVisualizeSnapshotMask`
  - `appshotShadowCornerRadius`
  - `appshotScreenshotCornerRadius`
  - `appshotShadowRadius`
  - `appshotShadowYOffset`
  - `appshotShadowOpacity`
  - `appshotAppIconFadeIn`
  - `appshotTitleFadeIn`
- Appshot sound resource is `Package_Appshot.bundle/Contents/Resources/Appshot.wav`.

这些是 native overlay 的可靠 vocabulary，但不是完整 timing spec。当前证据能证明 Codex 有独立的 AppKit/QuartzCore transition presenter；不能仅凭 renderer spring 或符号名推导所有 native timing 常量。

`app-asar-extracted/webview/assets/appshot-window-BfJPMFJq.js` 只是 Appshot 图标 SVG，不是 Appshot overlay window 的实现。不要把这个文件当成动效入口。

### Private Transport

从解包的 Codex Computer Use helper 和 Cradle 的 runtime probing 可以确认：

- worker 到 helper 的 Apple Event bridge 使用：
  - event class `SkCu`
  - event id `SndR`
  - request type keyword `RspT`
  - request data keyword `ReqD`
  - client version keyword `ClVn`
  - client version `CodexComputerUseNativeBridge-1`
- request types:
  - `ComputerUseIPCAppStartCaptureRequest`
  - `ComputerUseIPCAppNextCaptureUpdateRequest`
- native/protobuf symbols include:
  - `ComputerUseIPCAppStartCaptureAnimationTarget`
  - `ComputerUseIPCAppStartCaptureAnimationColor`
  - `ComputerUseIPCAppStartCaptureAnimationDisplay`
  - `ComputerUseIPCAppStartCaptureAnimationRect`
  - `animationTarget`
  - `destinationFrame`
  - `destinationCornerRadius`
  - `destinationBackgroundColor`
  - `destinationPrimaryTextColor`
  - `animationDuration`
  - `transitionSnapshotHeight`
  - `transitionSpringResponse`
  - `transitionSpringDampingFraction`
  - `transitionSnapshotURL`

Renderer-level `animationDestination` and native-level `animationTarget` are the same conceptual destination crossing two naming layers. Cradle code should name its boundary explicitly instead of pretending there is only one shape.

### Private Apple Event Authorization

Runtime probing on 2026-05-25 added one more constraint:

- `SkyComputerUseService` can be launched and discovered as `com.openai.sky.CUAService`.
- Cradle's Swift adapter sends the same observed Apple Event constants and request shape as Codex worker:
  - target descriptor: kernel process id
  - event class/id: `SkCu` / `SndR`
  - params: `RspT`, `ReqD`, `ClVn`
  - data descriptor types: `tdta` and `utf8`
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
- Present a Cradle-owned AppKit/QuartzCore overlay that follows the Codex-observed native layer vocabulary:
  - background fade
  - shutter fade
  - snapshot image fade
  - rounded snapshot mask
  - shadow layer and mask behavior
  - magic-move frame animation
  - app icon fade
  - title fade
- Play Cradle-packaged `Resources/Appshot.wav`.

`cradle-native` keeps protocol coordinates, renderer coordinates, and overlay coordinates separate:

- Renderer/composer destination is top-left viewport geometry in device pixels.
- Native source is the frontmost captured window bounds.
- Native overlay converts source and destination rectangles into AppKit screen coordinates only inside the presenter.

The native transition tracks two source rectangles:

- `sourceWindowFrame` is the actual captured PNG frame. It may be larger than the CoreGraphics window bounds when the capture backend includes transparent shadow padding.
- `sourceContentFrame` is the target application window bounds from CoreGraphics. It includes the title bar and traffic-light controls, but excludes capture shadow padding.

The magic-move container source frame is `sourceContentFrame`, so the white `shutterLayer`, snapshot mask, and starting shadow cover the whole target window including the title bar and traffic lights without expanding to the PNG shadow padding. The captured PNG still uses `sourceWindowFrame`, but only as the internal `snapshotImageLayer` frame inside the source-content container; this preserves shadow/transparent edge pixels without letting screenshot padding move the white cover. The destination frame is renderer-owned when Appshot is triggered from the composer. Research paths that do not have renderer context may synthesize a composer-like destination, but they must not reuse the source window bounds as the destination because that would hide transition geometry regressions.

The Codex binary evidence gives reliable layer vocabulary and resource inventory, but it does not expose every numeric transition constant as a stable public contract. Cradle should not invent a product-level native transition calibration object around those unknowns. The native presenter uses fixed, evidence-aligned layer names and animation phases instead of accepting caller-provided transition style overrides.

`transitionSpringResponse`, `transitionSpringDampingFraction`, and normalized `transitionSnapshotHeight` may be returned to the renderer so the composer placeholder grows like Codex. They should not be used as the source of truth for the native overlay timing.

`cradle-native` is the default production path for both Command hotkey and future slash command attachment flow.

### `codex-private`

Owner: `apps/desktop/native/macos/mac-bridge/Sources/CradleMacBridge/CodexAppshotPrivateAdapter.swift`.

Responsibilities:

- Detect `com.openai.sky.CUAService`.
- Send the private Apple Event protocol with `CodexComputerUseNativeBridge-1`.
- Translate Cradle's boundary object into Codex private request naming:
  - renderer-style `animationDestination`
  - native/protobuf-style `animationTarget`
- Poll `ComputerUseIPCAppNextCaptureUpdateRequest`.
- Return Codex update records.
- Attach Cradle-owned `cradleTranscript` evidence to successful start/update replies and to native Apple Event send failures. The transcript records the request envelope, request payload, descriptor types, request/response byte counts, hashes, timing, parsed reply payload, and native send error metadata.
- In Electron main, resolve Codex file URL/path image updates only when they live under `/tmp/com.openai.sky.CUAService`.
- Expose local path and data URL for resolved screenshot and transition snapshot assets.

`codex-private` is intentionally strict. If the caller explicitly selects it and the helper/protocol is unavailable, Cradle should throw instead of silently pretending success. In `auto`, Cradle may fall back to `cradle-native`.

### Composer Attachment Flow

Owner: `apps/web/src/features/chat`.

The chat feature defines Appshot as a Cradle-owned UI command, not a runtime-native slash command. Runtime slash commands remain raw text passthrough because their semantics belong to the active chat runtime.

Cradle should mirror Codex's renderer split:

1. Read the current frontmost app/window context.
2. Allocate a request id and insert a pending Appshot placeholder into the attachment tray.
3. Measure the composer attachment slot and produce a renderer-owned destination:
   - `viewportFrame`
   - `backgroundColor`
   - `cornerRadius`
   - `primaryTextColor`
   - local-only `transitionSnapshotScale`
4. Call Electron main with the destination and bundle identifier.
5. Use start response values only to update the pending placeholder height/spring.
6. Consume update stream events to build a final Appshot context.
7. Replace the pending placeholder with the final Appshot card when `completed` arrives.

The slash command surface only consumes renderer-safe image data URLs returned by Electron main. It does not read Codex temp files directly and does not know whether the final capture came from `codex-private` or `cradle-native`.

### Parity Probe

Owner: `apps/desktop/src/main/native-services.ts`.

`macCapture.captureAppshotParityProbe` is a desktop research API for controlled comparison. It reads the frontmost context, chooses the renderer-provided destination or synthesizes a composer-like destination, starts a Codex private capture when authorized, locks the Cradle-native source window to the initially observed `windowId` and `processId`, and returns both results plus the actual destination and renderer placeholder calibration that were applied.

The companion `record:appshot-parity` script records evidence into `docs/manual-reports` and supports three Codex evidence sources:

- `direct`: sends the private Apple Event protocol to `com.openai.sky.CUAService`. This is the strict protocol compatibility diagnostic path.
- `observe`: does not send Apple Events. It snapshots `/tmp/com.openai.sky.CUAService`, waits while the operator triggers Codex Appshot from Codex UI, then copies newly written image assets into Cradle-owned report storage. When `--record-video` is enabled, the recorder starts Cradle-owned display recording before printing the trigger prompt and saves the observation window as `codex-observed-appshot.mov`.
- `direct-and-observe`: runs both paths in one report. This is useful when direct Apple Event calls hit sender authorization timeouts but Codex UI can still produce temp assets.

The observer path exists because Codex Computer Use applies sender authorization in addition to the Apple Event schema. It preserves namespace ownership: Cradle reads Codex-owned temp assets and copies evidence into Cradle-owned reports, but it never writes into `/tmp/com.openai.sky.CUAService`.

The recorder emits hashes and image dimensions for copied Codex and Cradle assets. When video recording is enabled, extracted decoded PNG frames are the pixel-level evidence because they remove H.264 container and encoder differences from the assertion. In observe mode the operator-triggered Codex clip can have arbitrary leading idle frames, so the recorder must detect transition start from adjacent-frame changes, record transition-frame alignment, and compare the aligned transition window. Raw frame comparison and whole-video SSIM/PSNR remain diagnostic evidence, not the hard pixel-perfect predicate.

The report also includes Cradle-native transition probes because external macOS recording paths can fail independently from the AppKit overlay:

- `mac.appshot.probeTransitionVisibility` records whether CoreGraphics can enumerate the overlay window and whether external capture can produce proof frames.
- `mac.appshot.probeTransitionPresentation` samples the Core Animation layer tree from inside the native presenter, writes Cradle-owned presentation PNGs, and records snapshot frame and opacity changes.
- The presentation probe must prove that the first white `shutterLayer` frame equals `expectedStartContentBounds`, the first shadow frame equals `expectedStartContentFrame`, the internal image layer starts at `expectedSnapshotImageStartFrame`, and the final shutter, snapshot, and shadow frames equal the composer destination slot.

These probes can prove that Cradle's overlay is internally moving, but they do not prove Codex parity. Pixel parity still requires Codex UI occurrence, aligned comparable frames, static assets, sound comparison, and Cradle recording visibility.

This API exists to produce parity evidence and tune the Cradle-native transition. It is not the product default and should not make Codex private protocol compatibility a Cradle-owned stable contract.

## Strategy Selection

Use:

- `cradle-native` for product behavior, packaging, repeatability, and long-term ownership.
- `codex-private` for research, regression comparison, and validating parity against Codex helper behavior.
- `auto` for user-triggered capture: Electron main reads the frontmost context when needed, tries `codex-private` with the current renderer destination and bundle identifier, then falls back to `cradle-native` if Codex private capture is unavailable.

The reason is ownership: Codex owns its private protocol compatibility and migration. Cradle owns Cradle Appshot semantics and storage.

## Verification

Current implementation-level gates:

- Swift build for `cradle-mac-bridge`.
- Desktop main TypeScript typecheck.
- `mac-bridge-manager.test.ts` covers NDJSON methods for `mac.appshot.captureFrontmostWindow` and `mac.codexAppshot.*`.
- `native-services.test.ts` covers parity target synthesis so research probes do not silently fall back to source-equals-destination geometry.
- Composer tests cover pending Appshot placeholder insertion, destination measurement, start-response height/spring normalization, update-stream completion, and final Appshot context attachment.
- Slash command tests cover Cradle-owned `/appshot` command registration and image-capability gating.
- `build-mac-bridge.mjs` must produce `.build/cradle-dist/cradle-mac-bridge` and `.build/cradle-dist/resources/Appshot.wav`.
- `record:appshot-parity` must be used for runtime visual/audio parity evidence before declaring pixel parity.
- `record:appshot-parity -- --require-proven-parity` must fail until the report contains complete proof for every visual and audio parity gate.

Parity gates required before declaring `cradle-native` visually 100% same as Codex Appshot:

- Capture Codex Appshot and Cradle Appshot on the same frontmost window, display scale, theme, and destination frame.
- Record both native overlay transitions at the same frame rate.
- Compare:
  - sound resource duration and waveform identity
  - native transition duration
  - shutter fade timing
  - snapshot fade timing
  - shadow radius, opacity, and offset
  - corner radius
  - app icon/title fade timing
  - final snapshot frame and mask geometry
  - transition snapshot output
- Separately verify composer placeholder animation:
  - pending placeholder initial/animate dimensions
  - `transitionSnapshotHeight / transitionSnapshotScale` normalization
  - spring defaults and helper-returned overrides
  - final replacement by Appshot context card
- Keep the comparison artifact under a Cradle-owned research or manual report path.
- The sound comparison must show Codex and Cradle `Appshot.wav` as byte-identical.
- The executable parity gate must pass with `parityStatus.provenPixelPerfect: true`.

Until those runtime artifacts exist, the implementation is Codex-evidence-aligned, not yet proven pixel-perfect.
