<!-- Once this directory changes, update this README.md -->

# Apps/Desktop/Scripts

Desktop-owned release and native-runtime helper scripts.

## Files

- **rebuild-server-native.mjs**: Rebuilds server native dependencies for the Electron runtime after the server build has installed runtime dependencies.
- **build-mac-bridge.mjs**: Builds the Swift `cradle-mac-bridge` executable on macOS, atomically replaces the deterministic desktop packaging binary, and copies Mac Bridge runtime resources such as `Appshot.wav` into `.build/cradle-dist/resources`. Non-macOS hosts skip this step so shared CI can continue to build non-macOS slices.
- **record-appshot-parity.mjs**: Records observe-only Codex UI Appshot evidence and Cradle native Appshot evidence into `docs/manual-reports`, copying newly observed Codex temp assets into Cradle-owned report storage and optionally capturing videos and extracted frames for visual/audio parity review. `--codex-source` now supports only `observe`; the direct Codex private Apple Event adapter has been removed from Mac Bridge. In observe mode, `--record-video` starts the Cradle-owned recorder before prompting the operator to trigger Codex UI AppShot, then saves that window as `codex-observed-appshot.mov`. `--auto-trigger-codex-hotkey` is an explicit opt-in helper for parity runs; it asks Mac Bridge to post public synthetic both-Command key events with `--codex-hotkey-hold-ms <ms>` and does not call Codex private Apple Event protocols. Reports include static image comparisons between copied Codex assets and Cradle assets, with dimension/hash checks plus SSIM/PSNR metrics when dimensions match. When `--record-video` is enabled, `--recording-backend auto` tries the Cradle-owned ScreenCaptureKit window-discovery recorder first, then the Mac Bridge display recorder, then the macOS `screencapture` video path, then an FFmpeg AVFoundation screen device if one is exposed; every backend attempt is written into `report.json` so recorder failures are separate from Appshot trigger failures. The Mac Bridge display recorder itself prefers ScreenCaptureKit and reports its actual fallback backend, such as `core-graphics-window-list-polling`, when ScreenCaptureKit cannot enumerate displays. The window-discovery recorder can select a newly appearing Appshot overlay by bundle identifier and display bounds; if ScreenCaptureKit selects the overlay but delivers no frames, the report records `screen-window-recording-empty` instead of treating the attempt as proof. Raw `.mov` files are preserved as capture evidence. Cradle-native report sections also include `visibilityProbe`, which records whether CoreGraphics can enumerate and externally image the overlay panel, and `presentationProbe`, which renders native Core Animation presentation frames plus geometry/opacity samples to prove whether the Cradle-owned overlay moved independently from recorder visibility. The presentation probe checks the Codex-aligned native layer tree, full-window start geometry, white shutter rounded cover, snapshot mask, app icon/title fade, and the final 232x140 composer image frame; it no longer treats raw screenshot aspect-fit body size as the native handoff target. Cradle frontend evidence also checks the title-aware composer card that uses the transition snapshot, falls back to the capture image, and renders app icon plus title consistently with the native transition. When both Codex and Cradle recordings are available, extracted frames and whole-video SSIM/PSNR use a normalized comparison window equal to the shorter raw recording duration; this removes recorder start/stop padding without mutating the raw videos. Cradle-native captures use a locked `targetWindow` from the initial frontmost context, and reports include `targetLock` so the gate can prove Cradle replay captured the same source window after Codex UI interaction. Reports include `codex.appshotEvidence`, and the executable gate requires proof that Codex AppShot actually occurred through newly observed Codex temp assets or observed transition video; a static observe recording is never enough by itself. Decoded normalized PNG frame hashes are the pixel-perfect gate because they avoid H.264 container and encoder noise. In observe mode, manual Codex UI triggering can add arbitrary leading idle frames, so reports include `transitionFrameAlignment`; the hard gate compares aligned transition frames while keeping raw frame comparison as diagnostics. When paired frames differ but dimensions match, visual diff PNGs are written under `frames/diff-raw` or `frames/diff-aligned` and referenced from frame comparison entries. Reports compare Codex and Cradle Appshot sound resources by hash and `ffprobe` metadata. Use `--alignment-ssim-threshold <number>` and `--alignment-consecutive-frame-count <number>` to tune transition onset detection. Use `--require-proven-parity` to write the report and then exit non-zero unless every visual and audio parity gate passes.
- **record-preview-installer-smoke.mjs**: Records machine-readable evidence from a real `/Applications` preview installer smoke test, without marking first-run, delta-update, or support lifecycle checks as passed unless explicit evidence files are provided.
- **release-preview.mjs**: Builds the desktop app, packages the current-platform unpacked app, and invokes Velopack `vpk pack` for preview release feeds without deleting previous packages needed for delta generation. On macOS, it post-processes the generated setup package so the installer seeds the installed version's full `.nupkg` into the user Velopack package cache and keeps a versioned setup package copy for release evidence.
- **release-preview-distribution.mjs**: Runs the macOS release-machine pipeline up to the non-installing distribution gate: credential preflight, signed/notarized preview release packaging, published update feed verification, and `verify-preview-distribution`.
- **verify-macos-distribution-credentials.mjs**: Checks local macOS Developer ID Application and Developer ID Installer identities, release-preview notary profile access, and Electron Builder signing configuration before starting expensive distribution packaging.
- **verify-preview-distribution.mjs**: Checks the stricter public-distribution gate for preview artifacts, including Velopack feed completeness, adjacent-version runtime delta verification, published update feed reachability, setup package seeded full-package contents, Developer ID app signature, Developer ID Installer package signature, stapled notarization tickets, release notes coverage, and real `/Applications` installer smoke evidence.
- **verify-preview-update.mjs**: Simulates a base preview installation from a full Velopack package and verifies that `UpdateManager` sees and downloads a delta-backed target update.

## Preview Distribution Gate

对于 macOS public distribution，`.app` 必须先由 Electron Builder mac signing flow 签名，再进入 Velopack packaging；setup `.pkg` 必须等 `release-preview.mjs` 把 full `.nupkg` seed 进 installer 之后再签名。post-processing 会改变 package 内容，所以在这个脚本之前签名 installer 并不充分。

在 macOS 上开始 distribution packaging 前，先运行本地 credential preflight：

    pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- \
      --mac-app-sign "Developer ID Application: Example Team (TEAMID)" \
      --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" \
      --mac-notary-profile cradle-preview

Preflight 是只读的。它不会导入证书、修改 keychain、签名 artifacts、公证 artifacts、安装 packages 或触碰 `/Applications`。如果机器没有可用的 Developer ID Application identity、Developer ID Installer identity 或 non-interactive notarytool keychain profile，它应该失败。

只要 macOS distribution options 需要 signing、notarization 或 stapling，`release-preview.mjs` 也会在 build/package work 前自动运行这个 preflight。上面的显式命令仍适合作为完整 release job 前的快速 release-machine readiness check。

当 Developer ID credentials 可用时，使用这些 release options：

    pnpm --filter @cradle/desktop release:preview -- \
      --version 0.0.1-preview.1 \
      --channel preview \
      --output release/preview-seeded-base-package \
      --release-notes ../../docs/for-users/preview-release-notes.md \
      --update-url https://updates.example.com/cradle/preview/ \
      --mac-app-sign "Developer ID Application: Example Team (TEAMID)" \
      --require-mac-app-signature \
      --mac-app-notarize \
      --mac-app-staple \
      --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" \
      --mac-notary-profile cradle-preview \
      --mac-notarize \
      --mac-staple

在 release machine 上，优先使用高层 pipeline command，让 credential preflight、signed/notarized release packaging 和 distribution verifier 每次都按相同顺序运行：

    pnpm --filter @cradle/desktop release:preview-distribution -- \
      --version 0.0.1-preview.1 \
      --channel preview \
      --output release/preview-seeded-base-package \
      --release-notes ../../docs/for-users/preview-release-notes.md \
      --mac-app-sign "Developer ID Application: Example Team (TEAMID)" \
      --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" \
      --mac-notary-profile cradle-preview \
      --update-url https://updates.example.com/cradle/preview/ \
      --installer-smoke release/preview-seeded-base-package/installer-smoke.json

`release:preview` 在 macOS 分发打包路径中也要求 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL`。只要传入 `--require-mac-app-signature`、`--mac-installer-sign`、`--mac-app-notarize`、`--mac-app-staple`、`--mac-notarize` 或 `--mac-staple`，底层脚本就会在 build 前要求发布 feed URL、拒绝非 loopback 的明文 HTTP，并在 Velopack packaging 前检查 packaged `.app` 的 `Contents/Resources/app.asar` 已经内嵌同一个 URL。

`release:preview-distribution` 要求传入 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL`。它会把同一个 URL 作为显式 `--update-url` 参数传给 `release-preview.mjs`，同时注入 build environment，并传给 `verify-preview-distribution`，确保 packaged app 和最终门禁使用同一个 published Velopack feed。Verifier 会从该 URL 拉取 `releases.preview.json`、`assets.preview.json` 以及关键 full/delta/setup/portable artifacts，并检查远端 bytes 与本地 release output 一致。

Public preview feeds 必须使用 HTTPS。明文 HTTP 只允许用于 localhost loopback verification，例如临时 `http://127.0.0.1:<port>/` server 服务一个尚未发布的 release directory。

Distribution verifier 还会检查 packaged `.app` 的 `Contents/Resources/app.asar` 是否内嵌同一个 update URL。如果传入 `--skip-build` 或 `--skip-electron-package`，只能复用由同一个 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL` 构建出的 artifacts；否则即使远端 feed 可达，`release:preview` 或最终 verifier 也会失败。

`release:preview-distribution` 不会安装到 `/Applications`；当提供 `--installer-smoke` 时，它只会把既有 typed smoke evidence file 传给 `verify-preview-distribution`。这个文件必须在真实 smoke-test machine 上安装 signed and notarized setup package 后，用 `record:preview-installer-smoke` 生成。

传入 `--mac-app-sign`、`--mac-installer-sign`、`--mac-notarize`、`--mac-staple` 或 `--require-mac-app-signature` 后，如果 unpacked `.app` 仍是 ad-hoc signed 或没有 TeamIdentifier，脚本会在 Velopack packaging 前失败。需要先配置 Electron Builder mac signing credentials，重建 unpacked app，再重新运行 `release:preview`。

传入 `--mac-app-notarize` 会在 Velopack packaging 前提交 signed `.app` 的 zipped copy；传入 `--mac-app-staple` 会在 `.app` 被打进 `.nupkg` 和 setup `.pkg` artifacts 前完成 staple。任何 notarization option 都要求 `--mac-notary-profile`，避免 release automation 落入 interactive credential prompt。

传入 `--mac-notarize` 或 `--mac-staple` 也要求 `--mac-installer-sign`，因为 setup `.pkg` 必须先签名，Apple notarization 才能产出有效 distribution artifact。传入 `--mac-staple` 要求在同一次 `release:preview` 中同时传入 `--mac-notarize`，因为脚本会在 seeded package post-processing 阶段重写 setup `.pkg`，任何旧 notarization ticket 都不能描述最终 package 内容。

After installing the signed and notarized setup package into `/Applications`, record smoke evidence:

    pnpm --filter @cradle/desktop record:preview-installer-smoke -- \
      --release-dir release/preview-seeded-base-package \
      --first-run-evidence /path/to/first-run-evidence.json \
      --delta-update-evidence /path/to/delta-update-evidence.json \
      --support-evidence /path/to/support-evidence.json

Generate templates for the three required evidence files before the real smoke test:

    pnpm --filter @cradle/desktop record:preview-installer-smoke -- \
      --release-dir release/preview-seeded-base-package \
      --write-evidence-templates /path/to/smoke-evidence

Each evidence file must keep its expected `kind`, set top-level `"passed": true`, and set every required checklist field to `true`. Delta-update evidence must also include `metrics.deltaCount >= 1`, `metrics.deltaBytes > 0`, and `metrics.fullBytes > metrics.deltaBytes` so a full-package fallback cannot satisfy the incremental-update release requirement. The recorder still checks `/Applications/Cradle.app`, installed version, seeded Velopack package cache with matching size, and user documentation before writing `installer-smoke.json`.

Run this before calling a preview artifact distribution-ready:

    pnpm --filter @cradle/desktop verify:preview-distribution -- \
      --release-dir release/preview-seeded-base-package \
      --update-url https://updates.example.com/cradle/preview/

这个 gate 也会运行 adjacent-version runtime delta verifier 和 published feed verifier；如果本地或 published release feed 缺少 `RELEASES-preview`、previous full package、latest full package、latest delta package、previous versioned setup package、latest versioned setup package、generic setup package 或 portable zip，signed artifacts 也不能通过。generic setup package 必须与 latest versioned setup package size 一致，确保 stable download URL 和 immutable evidence artifact 指向同一份 installer 内容。Public gate 会直接读取 previous/latest full `.nupkg` 和 portable zip 里的 `app.asar`，确认这些发布 archives 也内嵌同一个 update URL；它还会展开每个 feed-derived setup `.pkg`，确认 `1.pkg/Scripts/` 中携带对应版本的 full `.nupkg`、该文件与 release output 字节一致、setup payload 中的 `Cradle.app/Contents/Resources/app.asar` 与对应 full `.nupkg` 的 `app.asar` 字节一致，并且 `postinstall` 会把 seeded package 写回 `Library/Caches/velopack/<packageId>/packages`。最后，它会对能从 release feed 推导出的每个 published setup package 检查 payload `Cradle.app` 的 Developer ID signature 和 stapled notarization ticket，以及外层 setup `.pkg` 的 Developer ID Installer signature 和 stapled notarization ticket，包括 previous versioned、latest versioned 和 generic setup packages；`--setup-pkg` 只是额外显式 package path，不是唯一会被检查的 installer。

The gate is expected to fail until the artifacts are signed with Developer ID credentials, submitted to Apple notarization, stapled, and backed by real installer smoke evidence.

The default installer smoke evidence path is `apps/desktop/release/preview-seeded-base-package/installer-smoke.json`. It must contain:

    {
      "checkedAt": "2026-05-21T21:48:00.000Z",
      "installerPackage": "apps/desktop/release/preview-seeded-base-package/com.cradle.app-preview-Setup.pkg",
      "installedApp": "/Applications/Cradle.app",
      "installedAppExists": true,
      "installedVersion": "0.0.1-preview.1",
      "expectedVersion": "0.0.1-preview.1",
      "firstRunPassed": true,
      "deltaUpdatePassed": true,
      "supportLifecyclePassed": true,
      "uninstallPathDocumented": true,
      "seededBasePackage": {
        "exists": true,
        "sizeMatches": true
      },
      "firstRunEvidence": {
        "kind": "cradle-preview-first-run-evidence",
        "passed": true
      },
      "deltaUpdateEvidence": {
        "kind": "cradle-preview-delta-update-evidence",
        "passed": true
      },
      "supportEvidence": {
        "kind": "cradle-preview-support-evidence",
        "passed": true
      },
      "passed": true
    }

Do not create this evidence from a temp installed layout. It is only valid after installing the setup package into `/Applications` and verifying the installed app path.
