// Presents Cradle-owned Appshot capture transitions with AppKit and Core Animation.
import AppKit
import ImageIO
import QuartzCore
import UniformTypeIdentifiers

struct AppshotTransitionResult {
    let animationDuration: TimeInterval
    let transitionSnapshotPath: String?
    let transitionSnapshotHeight: Double?
    let transitionSpringDampingFraction: Double?
    let transitionSpringResponse: Double?
    let transitionStyle: AppshotTransitionStyle

    func serialize() -> [String: Any] {
        [
            "strategy": "cradle-native",
            "animationDuration": animationDuration,
            "transitionSnapshotPath": transitionSnapshotPath ?? NSNull(),
            "transitionSnapshotHeight": transitionSnapshotHeight ?? NSNull(),
            "transitionSpringDampingFraction": transitionSpringDampingFraction ?? NSNull(),
            "transitionSpringResponse": transitionSpringResponse ?? NSNull(),
            "transitionStyle": transitionStyle.serialize(),
        ]
    }
}

struct AppshotTransitionCalibration {
    let animationDuration: TimeInterval
    let transitionSnapshotHeight: Double?
    let springResponse: Double
    let springDampingFraction: Double
    let style: AppshotTransitionStyle

    static func from(params: [String: Any], target: AppshotTransitionTarget) -> AppshotTransitionCalibration {
        let animationDuration = readPositiveDouble(params["animationDuration"]) ?? 0.88
        let transitionSnapshotHeight = readPositiveDouble(params["transitionSnapshotHeight"]).map { $0 / Double(target.transitionSnapshotScale) }
            ?? Double(target.destinationFrame.height)
        let springResponse = readPositiveDouble(params["transitionSpringResponse"]) ?? 0.52
        let springDampingFraction = readPositiveDouble(params["transitionSpringDampingFraction"]) ?? 0.82
        let style = AppshotTransitionStyle.from(params: params["transitionStyle"] as? [String: Any])
        return AppshotTransitionCalibration(
            animationDuration: animationDuration,
            transitionSnapshotHeight: transitionSnapshotHeight,
            springResponse: springResponse,
            springDampingFraction: springDampingFraction,
            style: style
        )
    }

}

struct AppshotTransitionStyle {
    let transitionBackgroundOpacity: CGFloat
    let shutterPeakOpacity: Float
    let shutterPeakProgress: NSNumber
    let backgroundPeakProgress: NSNumber
    let snapshotFadeInProgress: NSNumber
    let appIconFadeStartProgress: NSNumber
    let appIconVisibleProgress: NSNumber
    let titleFadeStartProgress: NSNumber
    let titleVisibleProgress: NSNumber
    let completionDelay: TimeInterval
    let destinationShadowRadius: CGFloat
    let destinationShadowYOffset: CGFloat
    let destinationShadowOpacity: Float
    let keyShadowRadius: CGFloat
    let keyShadowYOffset: CGFloat
    let keyShadowOpacity: Float
    let ambientShadowRadius: CGFloat
    let ambientShadowYOffset: CGFloat
    let ambientShadowOpacity: Float
    let shadowFillOpacity: CGFloat
    let accessoryIconSize: CGFloat
    let accessoryIconYOffset: CGFloat
    let accessoryTitleYOffset: CGFloat

    static func from(params: [String: Any]?) -> AppshotTransitionStyle {
        AppshotTransitionStyle(
            transitionBackgroundOpacity: CGFloat(readUnitDouble(params?["transitionBackgroundOpacity"]) ?? 0.08),
            shutterPeakOpacity: Float(readUnitDouble(params?["shutterPeakOpacity"]) ?? 0.48),
            shutterPeakProgress: NSNumber(value: readUnitDouble(params?["shutterPeakProgress"]) ?? 0.2),
            backgroundPeakProgress: NSNumber(value: readUnitDouble(params?["backgroundPeakProgress"]) ?? 0.22),
            snapshotFadeInProgress: NSNumber(value: readUnitDouble(params?["snapshotFadeInProgress"]) ?? 0.18),
            appIconFadeStartProgress: NSNumber(value: readUnitDouble(params?["appIconFadeStartProgress"]) ?? 0.18),
            appIconVisibleProgress: NSNumber(value: readUnitDouble(params?["appIconVisibleProgress"]) ?? 0.58),
            titleFadeStartProgress: NSNumber(value: readUnitDouble(params?["titleFadeStartProgress"]) ?? 0.28),
            titleVisibleProgress: NSNumber(value: readUnitDouble(params?["titleVisibleProgress"]) ?? 0.6),
            completionDelay: readNonnegativeDouble(params?["completionDelay"]) ?? 0.08,
            destinationShadowRadius: CGFloat(readNonnegativeDouble(params?["destinationShadowRadius"]) ?? 18),
            destinationShadowYOffset: CGFloat(readFiniteDouble(params?["destinationShadowYOffset"]) ?? -6),
            destinationShadowOpacity: Float(readUnitDouble(params?["destinationShadowOpacity"]) ?? 0.16),
            keyShadowRadius: CGFloat(readNonnegativeDouble(params?["keyShadowRadius"]) ?? 34),
            keyShadowYOffset: CGFloat(readFiniteDouble(params?["keyShadowYOffset"]) ?? -12),
            keyShadowOpacity: Float(readUnitDouble(params?["keyShadowOpacity"]) ?? 0.18),
            ambientShadowRadius: CGFloat(readNonnegativeDouble(params?["ambientShadowRadius"]) ?? 64),
            ambientShadowYOffset: CGFloat(readFiniteDouble(params?["ambientShadowYOffset"]) ?? -22),
            ambientShadowOpacity: Float(readUnitDouble(params?["ambientShadowOpacity"]) ?? 0.10),
            shadowFillOpacity: CGFloat(readUnitDouble(params?["shadowFillOpacity"]) ?? 0.08),
            accessoryIconSize: CGFloat(readPositiveDouble(params?["accessoryIconSize"]) ?? 24),
            accessoryIconYOffset: CGFloat(readFiniteDouble(params?["accessoryIconYOffset"]) ?? 12),
            accessoryTitleYOffset: CGFloat(readFiniteDouble(params?["accessoryTitleYOffset"]) ?? -18)
        )
    }

    func serialize() -> [String: Any] {
        [
            "transitionBackgroundOpacity": Double(transitionBackgroundOpacity),
            "shutterPeakOpacity": Double(shutterPeakOpacity),
            "shutterPeakProgress": shutterPeakProgress.doubleValue,
            "backgroundPeakProgress": backgroundPeakProgress.doubleValue,
            "snapshotFadeInProgress": snapshotFadeInProgress.doubleValue,
            "appIconFadeStartProgress": appIconFadeStartProgress.doubleValue,
            "appIconVisibleProgress": appIconVisibleProgress.doubleValue,
            "titleFadeStartProgress": titleFadeStartProgress.doubleValue,
            "titleVisibleProgress": titleVisibleProgress.doubleValue,
            "completionDelay": completionDelay,
            "destinationShadowRadius": Double(destinationShadowRadius),
            "destinationShadowYOffset": Double(destinationShadowYOffset),
            "destinationShadowOpacity": Double(destinationShadowOpacity),
            "keyShadowRadius": Double(keyShadowRadius),
            "keyShadowYOffset": Double(keyShadowYOffset),
            "keyShadowOpacity": Double(keyShadowOpacity),
            "ambientShadowRadius": Double(ambientShadowRadius),
            "ambientShadowYOffset": Double(ambientShadowYOffset),
            "ambientShadowOpacity": Double(ambientShadowOpacity),
            "shadowFillOpacity": Double(shadowFillOpacity),
            "accessoryIconSize": Double(accessoryIconSize),
            "accessoryIconYOffset": Double(accessoryIconYOffset),
            "accessoryTitleYOffset": Double(accessoryTitleYOffset),
        ]
    }
}

struct AppshotTransitionTarget {
    let sourceWindowFrame: CGRect
    let destinationFrame: CGRect
    let destinationBackgroundColor: NSColor
    let destinationPrimaryTextColor: NSColor
    let destinationCornerRadius: CGFloat
    let transitionSnapshotScale: CGFloat
    let displayFrame: CGRect
    let displayWorkArea: CGRect
    let displayScaleFactor: CGFloat
    let appKitDisplayFrame: CGRect

    static func from(params: [String: Any], fallbackWindowBounds: [String: Double]?) -> AppshotTransitionTarget {
        let sourceWindowFrame = fallbackDestinationFrame(fallbackWindowBounds)
        if let rawTarget = params["animationTarget"] as? [String: Any],
           let rawDestinationFrame = rawTarget["destinationFrame"] as? [String: Any],
           let rawDisplay = rawTarget["codexDisplay"] as? [String: Any] {
            let scaleFactor = (rawDisplay["scaleFactor"] as? NSNumber)?.doubleValue ?? Double(NSScreen.main?.backingScaleFactor ?? 2)
            let transitionSnapshotScale = readPositiveDouble(rawTarget["transitionSnapshotScale"]) ?? scaleFactor
            let destinationFrame = readRect(rawDestinationFrame) ?? fallbackDestinationFrame(fallbackWindowBounds)
            let displayBounds = readRect(rawDisplay["bounds"] as? [String: Any]) ?? fallbackDisplayFrame(containing: destinationFrame)
            let displayWorkArea = readRect(rawDisplay["workArea"] as? [String: Any]) ?? displayBounds
            let displayId = (rawDisplay["id"] as? NSNumber)?.intValue
            return AppshotTransitionTarget(
                sourceWindowFrame: sourceWindowFrame,
                destinationFrame: destinationFrame,
                destinationBackgroundColor: readColor(rawTarget["destinationBackgroundColor"] as? String) ?? NSColor.windowBackgroundColor,
                destinationPrimaryTextColor: readColor(rawTarget["destinationPrimaryTextColor"] as? String) ?? NSColor.labelColor,
                destinationCornerRadius: CGFloat((rawTarget["destinationCornerRadius"] as? NSNumber)?.doubleValue ?? 12),
                transitionSnapshotScale: CGFloat(transitionSnapshotScale),
                displayFrame: displayBounds,
                displayWorkArea: displayWorkArea,
                displayScaleFactor: CGFloat(scaleFactor),
                appKitDisplayFrame: appKitDisplayFrame(displayId: displayId, displayFrame: displayBounds)
            )
        }

        let destinationFrame = fallbackDestinationFrame(fallbackWindowBounds)
        let displayFrame = fallbackDisplayFrame(containing: destinationFrame)
        return AppshotTransitionTarget(
            sourceWindowFrame: sourceWindowFrame,
            destinationFrame: destinationFrame,
            destinationBackgroundColor: NSColor.windowBackgroundColor,
            destinationPrimaryTextColor: NSColor.labelColor,
            destinationCornerRadius: 12,
            transitionSnapshotScale: NSScreen.main?.backingScaleFactor ?? 2,
            displayFrame: displayFrame,
            displayWorkArea: displayFrame,
            displayScaleFactor: NSScreen.main?.backingScaleFactor ?? 2,
            appKitDisplayFrame: appKitDisplayFrame(displayId: nil, displayFrame: displayFrame)
        )
    }

    var appKitSourceWindowFrame: CGRect {
        appKitRect(fromTopLeftRect: sourceWindowFrame)
    }

    var appKitDestinationFrame: CGRect {
        appKitRect(fromTopLeftRect: destinationFrame)
    }

    private func appKitRect(fromTopLeftRect rect: CGRect) -> CGRect {
        CGRect(
            x: appKitDisplayFrame.minX + rect.minX - displayFrame.minX,
            y: appKitDisplayFrame.minY + displayFrame.maxY - rect.maxY,
            width: rect.width,
            height: rect.height
        )
    }

    private static func readRect(_ raw: [String: Any]?) -> CGRect? {
        guard let raw,
              let x = raw["x"] as? NSNumber,
              let y = raw["y"] as? NSNumber,
              let width = raw["width"] as? NSNumber,
              let height = raw["height"] as? NSNumber,
              width.doubleValue > 0,
              height.doubleValue > 0
        else {
            return nil
        }
        return CGRect(x: x.doubleValue, y: y.doubleValue, width: width.doubleValue, height: height.doubleValue)
    }

    private static func fallbackDestinationFrame(_ bounds: [String: Double]?) -> CGRect {
        if let bounds,
           let x = bounds["x"],
           let y = bounds["y"],
           let width = bounds["width"],
           let height = bounds["height"],
           width > 0,
           height > 0 {
            return CGRect(x: x, y: y, width: width, height: height)
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let frame = screen.visibleFrame
        let width = min(frame.width * 0.48, 540)
        let height = min(frame.height * 0.34, 360)
        return CGRect(x: frame.midX - width / 2, y: frame.midY - height / 2, width: width, height: height)
    }

    private static func fallbackDisplayFrame(containing rect: CGRect) -> CGRect {
        NSScreen.screens.first(where: { $0.frame.intersects(rect) })?.frame
            ?? NSScreen.main?.frame
            ?? NSScreen.screens[0].frame
    }

    private static func appKitDisplayFrame(displayId: Int?, displayFrame: CGRect) -> CGRect {
        if let displayId,
           let screen = NSScreen.screens.first(where: {
               ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue == displayId
           }) {
            return screen.frame
        }
        return NSScreen.screens.first(where: {
            Int(round($0.frame.width)) == Int(round(displayFrame.width))
                && Int(round($0.frame.height)) == Int(round(displayFrame.height))
        })?.frame
            ?? NSScreen.main?.frame
            ?? NSScreen.screens[0].frame
    }
}

final class AppshotTransitionPresenter: @unchecked Sendable {
    private var activeSounds: [NSSound] = []

    func present(
        screenshotPath: String,
        transitionSnapshotPath: String?,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        soundEnabled: Bool
    ) -> AppshotTransitionResult {
        Task { @MainActor in
            self.presentOnMain(
                screenshotPath: screenshotPath,
                target: target,
                calibration: calibration,
                appTitle: appTitle,
                bundleIdentifier: bundleIdentifier,
                soundEnabled: soundEnabled
            )
        }

        return AppshotTransitionResult(
            animationDuration: calibration.animationDuration,
            transitionSnapshotPath: transitionSnapshotPath,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            transitionSpringDampingFraction: calibration.springDampingFraction,
            transitionSpringResponse: calibration.springResponse,
            transitionStyle: calibration.style
        )
    }

    @MainActor
    private func presentOnMain(
        screenshotPath: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        soundEnabled: Bool
    ) {
        let application = NSApplication.shared
        if application.activationPolicy() == .regular {
            application.setActivationPolicy(.accessory)
        }

        let panel = AppshotTransitionOverlayWindow(target: target)
        let view = AppshotTransitionView(
            screenshotPath: screenshotPath,
            target: target,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            transitionStyle: calibration.style,
            appTitle: appTitle,
            appIcon: readApplicationIcon(bundleIdentifier: bundleIdentifier)
        )
        panel.contentView = view
        panel.orderFrontRegardless()
        if soundEnabled {
            playAppshotSound()
        }
        view.play(
            duration: calibration.animationDuration,
            springResponse: calibration.springResponse,
            dampingFraction: calibration.springDampingFraction
        ) {
            Task { @MainActor in
                panel.orderOut(nil)
            }
        }
    }

    @MainActor
    private func playAppshotSound() {
        guard let soundURL = readAppshotSoundURL(),
              let sound = NSSound(contentsOf: soundURL, byReference: false)
        else {
            NSSound(named: NSSound.Name("Tink"))?.play()
            return
        }
        activeSounds.append(sound)
        sound.play()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak sound] in
            guard let sound else { return }
            self?.activeSounds.removeAll { $0 === sound }
        }
    }

    private func readAppshotSoundURL() -> URL? {
        let executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        let resourceURL = executableURL
            .deletingLastPathComponent()
            .appendingPathComponent("resources")
            .appendingPathComponent("Appshot.wav")
        if FileManager.default.fileExists(atPath: resourceURL.path) {
            return resourceURL
        }
        return nil
    }

    @MainActor
    private func readApplicationIcon(bundleIdentifier: String?) -> NSImage? {
        guard let bundleIdentifier,
              let application = NSRunningApplication
                  .runningApplications(withBundleIdentifier: bundleIdentifier)
                  .first(where: { !$0.isTerminated }),
              let icon = application.icon
        else {
            return nil
        }
        return icon
    }

    func probeVisibility(
        screenshotPath: String,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval
    ) throws -> [String: Any] {
        final class ProbeBox: @unchecked Sendable {
            var result: [String: Any]?
            var error: Error?
        }

        let box = ProbeBox()
        let semaphore = DispatchSemaphore(value: 0)
        Task { @MainActor in
            do {
                box.result = try await self.probeVisibilityOnMain(
                    screenshotPath: screenshotPath,
                    outputDir: outputDir,
                    target: target,
                    calibration: calibration,
                    appTitle: appTitle,
                    bundleIdentifier: bundleIdentifier,
                    sampleCount: sampleCount,
                    sampleIntervalSeconds: sampleIntervalSeconds
                )
            } catch {
                box.error = error
            }
            semaphore.signal()
        }

        let timeoutSeconds = max(Int(ceil(Double(sampleCount) * sampleIntervalSeconds + calibration.animationDuration + 8)), 12)
        if semaphore.wait(timeout: .now() + .seconds(timeoutSeconds)) == .timedOut {
            throw BridgeError("appshot-visibility-probe-timeout", "Appshot transition visibility probe timed out.", details: [
                "timeoutSeconds": String(timeoutSeconds),
            ])
        }
        if let error = box.error {
            throw error
        }
        guard let result = box.result else {
            throw BridgeError("appshot-visibility-probe-empty-result", "Appshot transition visibility probe did not produce a result.")
        }
        return result
    }

    func probePresentation(
        screenshotPath: String,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval
    ) throws -> [String: Any] {
        final class ProbeBox: @unchecked Sendable {
            var result: [String: Any]?
            var error: Error?
        }

        let box = ProbeBox()
        let semaphore = DispatchSemaphore(value: 0)
        Task { @MainActor in
            do {
                box.result = try await self.probePresentationOnMain(
                    screenshotPath: screenshotPath,
                    outputDir: outputDir,
                    target: target,
                    calibration: calibration,
                    appTitle: appTitle,
                    bundleIdentifier: bundleIdentifier,
                    sampleCount: sampleCount,
                    sampleIntervalSeconds: sampleIntervalSeconds
                )
            } catch {
                box.error = error
            }
            semaphore.signal()
        }

        let timeoutSeconds = max(Int(ceil(Double(sampleCount) * sampleIntervalSeconds + calibration.animationDuration + 8)), 12)
        if semaphore.wait(timeout: .now() + .seconds(timeoutSeconds)) == .timedOut {
            throw BridgeError("appshot-presentation-probe-timeout", "Appshot transition presentation probe timed out.", details: [
                "timeoutSeconds": String(timeoutSeconds),
            ])
        }
        if let error = box.error {
            throw error
        }
        guard let result = box.result else {
            throw BridgeError("appshot-presentation-probe-empty-result", "Appshot transition presentation probe did not produce a result.")
        }
        return result
    }

    @MainActor
    private func probeVisibilityOnMain(
        screenshotPath: String,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval
    ) async throws -> [String: Any] {
        try FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let panel = AppshotTransitionOverlayWindow(target: target)
        let view = AppshotTransitionView(
            screenshotPath: screenshotPath,
            target: target,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            transitionStyle: calibration.style,
            appTitle: appTitle,
            appIcon: readApplicationIcon(bundleIdentifier: bundleIdentifier)
        )
        panel.contentView = view
        panel.orderFrontRegardless()
        view.layoutSubtreeIfNeeded()

        view.play(
            duration: calibration.animationDuration,
            springResponse: calibration.springResponse,
            dampingFraction: calibration.springDampingFraction
        ) {}

        let panelWindowNumber = panel.windowNumber
        var samples: [[String: Any]] = []
        var imageCaptureEnabled = true
        samples.append(try await readVisibilityProbeSample(
            outputDir: outputDir,
            index: 0,
            target: target,
            panelWindowNumber: panelWindowNumber,
            imageCaptureEnabled: imageCaptureEnabled,
            imageCaptureTimeoutSeconds: 0.18
        ).value)
        if samples.last?["imageStatus"] as? String == "timeout" {
            imageCaptureEnabled = false
        }

        for index in 1...max(sampleCount, 1) {
            try await Task.sleep(nanoseconds: UInt64(max(sampleIntervalSeconds, 0.05) * 1_000_000_000))
            samples.append(try await readVisibilityProbeSample(
                outputDir: outputDir,
                index: index,
                target: target,
                panelWindowNumber: panelWindowNumber,
                imageCaptureEnabled: imageCaptureEnabled,
                imageCaptureTimeoutSeconds: 0.18
            ).value)
            if samples.last?["imageStatus"] as? String == "timeout" {
                imageCaptureEnabled = false
            }
        }

        panel.orderOut(nil)
        return [
            "panelWindowNumber": panelWindowNumber,
            "sampleCount": samples.count,
            "sampleIntervalSeconds": sampleIntervalSeconds,
            "animationDuration": calibration.animationDuration,
            "samples": samples,
        ]
    }

    @MainActor
    private func probePresentationOnMain(
        screenshotPath: String,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval
    ) async throws -> [String: Any] {
        try FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let panel = AppshotTransitionOverlayWindow(target: target)
        let view = AppshotTransitionView(
            screenshotPath: screenshotPath,
            target: target,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            transitionStyle: calibration.style,
            appTitle: appTitle,
            appIcon: readApplicationIcon(bundleIdentifier: bundleIdentifier)
        )
        panel.contentView = view
        panel.orderFrontRegardless()
        view.layoutSubtreeIfNeeded()

        view.play(
            duration: calibration.animationDuration,
            springResponse: calibration.springResponse,
            dampingFraction: calibration.springDampingFraction
        ) {}

        var samples: [[String: Any]] = []
        for index in 0..<max(sampleCount, 1) {
            if index > 0 {
                try await Task.sleep(nanoseconds: UInt64(max(sampleIntervalSeconds, 0.01) * 1_000_000_000))
            }
            samples.append(try view.readPresentationProbeSample(outputDir: outputDir, index: index))
        }

        panel.orderOut(nil)
        return [
            "panelWindowNumber": panel.windowNumber,
            "sampleCount": samples.count,
            "sampleIntervalSeconds": sampleIntervalSeconds,
            "animationDuration": calibration.animationDuration,
            "samples": samples,
        ]
    }

    private func readVisibilityProbeSample(
        outputDir: String,
        index: Int,
        target: AppshotTransitionTarget,
        panelWindowNumber: Int,
        imageCaptureEnabled: Bool,
        imageCaptureTimeoutSeconds: Double
    ) async throws -> ProbeSamplePayload {
        try await withCheckedThrowingContinuation { continuation in
            let completion = ProbeSampleCompletion(continuation: continuation)
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    completion.resolve(ProbeSamplePayload(value: try readVisibilityProbeSampleSync(
                        outputDir: outputDir,
                        index: index,
                        target: target,
                        panelWindowNumber: panelWindowNumber,
                        imageCaptureEnabled: imageCaptureEnabled
                    )))
                } catch {
                    completion.reject(error)
                }
            }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .milliseconds(Int(imageCaptureTimeoutSeconds * 1000))) {
                completion.resolve(ProbeSamplePayload(value: readVisibilityProbeTimeoutSample(
                    outputDir: outputDir,
                    index: index,
                    target: target,
                    panelWindowNumber: panelWindowNumber
                )))
            }
        }
    }
}

private struct ProbeSamplePayload: @unchecked Sendable {
    let value: [String: Any]
}

private final class ProbeSampleCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var resolved = false
    private let continuation: CheckedContinuation<ProbeSamplePayload, Error>

    init(continuation: CheckedContinuation<ProbeSamplePayload, Error>) {
        self.continuation = continuation
    }

    func resolve(_ value: ProbeSamplePayload) {
        lock.lock()
        if resolved {
            lock.unlock()
            return
        }
        resolved = true
        lock.unlock()
        continuation.resume(returning: value)
    }

    func reject(_ error: Error) {
        lock.lock()
        if resolved {
            lock.unlock()
            return
        }
        resolved = true
        lock.unlock()
        continuation.resume(throwing: error)
    }
}

private func readVisibilityProbeSampleSync(
    outputDir: String,
    index: Int,
    target: AppshotTransitionTarget,
    panelWindowNumber: Int,
    imageCaptureEnabled: Bool
) throws -> [String: Any] {
        let rawWindows = (try? readRawWindowInventory()) ?? []
        let matchingWindow = rawWindows.first { raw in
            readInteger(raw[kCGWindowNumber as String]) == panelWindowNumber
        }
        let imagePath = (outputDir as NSString).appendingPathComponent("appshot-visibility-sample-\(String(format: "%03d", index)).png")
        var imageStatus = "skipped-after-timeout"
        if imageCaptureEnabled {
            imageStatus = "missing"
            if let image = CGWindowListCreateImage(
                target.appKitDisplayFrame,
                .optionOnScreenOnly,
                kCGNullWindowID,
                [.bestResolution]
            ) {
                try writeProbePNGImage(image, filePath: imagePath)
                imageStatus = "written"
            }
        }

        return [
            "index": index,
            "capturedAt": isoTimestamp(),
            "panelWindowNumber": panelWindowNumber,
            "panelFoundInCoreGraphicsWindowList": matchingWindow != nil,
            "windowCount": rawWindows.count,
            "panelWindow": matchingWindow.map(serializeRawWindowForProbe) ?? NSNull(),
            "imagePath": imageStatus == "written" ? imagePath : NSNull(),
            "imageStatus": imageStatus,
        ]
}

private func readVisibilityProbeTimeoutSample(
    outputDir: String,
    index: Int,
    target: AppshotTransitionTarget,
    panelWindowNumber: Int
) -> [String: Any] {
    let rawWindows = (try? readRawWindowInventory()) ?? []
    let matchingWindow = rawWindows.first { raw in
        readInteger(raw[kCGWindowNumber as String]) == panelWindowNumber
    }
    let imagePath = (outputDir as NSString).appendingPathComponent("appshot-visibility-sample-\(String(format: "%03d", index)).png")
    return [
        "index": index,
        "capturedAt": isoTimestamp(),
        "panelWindowNumber": panelWindowNumber,
        "panelFoundInCoreGraphicsWindowList": matchingWindow != nil,
        "windowCount": rawWindows.count,
        "panelWindow": matchingWindow.map(serializeRawWindowForProbe) ?? NSNull(),
        "imagePath": NSNull(),
        "imageStatus": "timeout",
        "timedOutImagePath": imagePath,
        "sampleTimeoutSeconds": 0.18,
        "captureRect": serialize(rect: target.appKitDisplayFrame),
    ]
}

private func serializeRawWindowForProbe(_ raw: [String: Any]) -> [String: Any] {
    [
        "windowId": readInteger(raw[kCGWindowNumber as String]) ?? NSNull(),
        "ownerPid": readInteger(raw[kCGWindowOwnerPID as String]) ?? NSNull(),
        "ownerName": raw[kCGWindowOwnerName as String] as? String ?? NSNull(),
        "title": raw[kCGWindowName as String] as? String ?? NSNull(),
        "layer": readInteger(raw[kCGWindowLayer as String]) ?? NSNull(),
        "alpha": (raw[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? NSNull(),
        "bounds": readBounds(raw[kCGWindowBounds as String]) ?? NSNull(),
    ]
}

private func writeProbePNGImage(_ image: CGImage, filePath: String) throws {
    let url = URL(fileURLWithPath: filePath)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw BridgeError("png-destination-unavailable", "Could not create PNG destination for Appshot visibility probe image.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    if !CGImageDestinationFinalize(destination) {
        throw BridgeError("png-write-failed", "Could not write Appshot visibility probe image as PNG.")
    }
}

final class AppshotTransitionOverlayWindow: NSPanel {
    init(target: AppshotTransitionTarget) {
        super.init(
            contentRect: target.appKitDisplayFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        level = .statusBar
        ignoresMouseEvents = true
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class AppshotTransitionView: NSView {
    private let target: AppshotTransitionTarget
    private let transitionSnapshotHeight: CGFloat?
    private let transitionStyle: AppshotTransitionStyle
    private let appTitle: String?
    private let appIcon: NSImage?
    private let transitionBackgroundLayer = CALayer()
    private let destinationShadowLayer = CALayer()
    private let keyShadowLayer = CALayer()
    private let ambientShadowLayer = CALayer()
    private let shutterLayer = CALayer()
    private let snapshotEffectsLayer = CALayer()
    private let snapshotImageLayer = CALayer()
    private let snapshotMaskLayer = CAShapeLayer()
    private let snapshotMaskDebugLayer = CAShapeLayer()
    private let appIconLayer = CALayer()
    private let titleLayer = CATextLayer()

    init(
        screenshotPath: String,
        target: AppshotTransitionTarget,
        transitionSnapshotHeight: Double?,
        transitionStyle: AppshotTransitionStyle,
        appTitle: String?,
        appIcon: NSImage?
    ) {
        self.target = target
        self.transitionSnapshotHeight = transitionSnapshotHeight.map { CGFloat($0) }
        self.transitionStyle = transitionStyle
        self.appTitle = appTitle
        self.appIcon = appIcon
        super.init(frame: CGRect(origin: .zero, size: target.displayFrame.size))
        wantsLayer = true
        configureLayers(screenshotPath: screenshotPath)
    }

    required init?(coder: NSCoder) {
        nil
    }

    func play(duration: TimeInterval, springResponse: Double, dampingFraction: Double, completion: @escaping @Sendable () -> Void) {
        let startFrame = readStartFrame()
        let endFrame = readEndFrame()
        let finalMaskPath = CGPath(
            roundedRect: CGRect(origin: .zero, size: endFrame.size),
            cornerWidth: target.destinationCornerRadius,
            cornerHeight: target.destinationCornerRadius,
            transform: nil
        )

        snapshotEffectsLayer.frame = startFrame
        destinationShadowLayer.frame = startFrame
        keyShadowLayer.frame = startFrame
        ambientShadowLayer.frame = startFrame
        snapshotMaskLayer.path = CGPath(
            roundedRect: snapshotEffectsLayer.bounds,
            cornerWidth: target.destinationCornerRadius,
            cornerHeight: target.destinationCornerRadius,
            transform: nil
        )

        CATransaction.begin()
        CATransaction.setCompletionBlock {
            DispatchQueue.main.asyncAfter(deadline: .now() + self.transitionStyle.completionDelay, execute: completion)
        }
        CATransaction.setAnimationDuration(duration)
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1))

        animateSpringFrame(layer: snapshotEffectsLayer, from: startFrame, to: endFrame, response: springResponse, dampingFraction: dampingFraction, duration: duration, key: "appshotMagicMove")
        animateSpringFrame(layer: destinationShadowLayer, from: startFrame, to: endFrame, response: springResponse, dampingFraction: dampingFraction, duration: duration, key: "appshotDestinationShadowMagicMove")
        animateSpringFrame(layer: keyShadowLayer, from: startFrame, to: endFrame, response: springResponse, dampingFraction: dampingFraction, duration: duration, key: "appshotKeyShadowMagicMove")
        animateSpringFrame(layer: ambientShadowLayer, from: startFrame, to: endFrame, response: springResponse, dampingFraction: dampingFraction, duration: duration, key: "appshotAmbientShadowMagicMove")
        animateOpacity(
            layer: transitionBackgroundLayer,
            values: [0, 1, 0],
            keyTimes: [0, transitionStyle.backgroundPeakProgress, 1],
            duration: duration,
            key: "appshotBackgroundFade"
        )
        animateOpacity(
            layer: shutterLayer,
            values: [0, transitionStyle.shutterPeakOpacity, 0],
            keyTimes: [0, transitionStyle.shutterPeakProgress, 1],
            duration: duration,
            key: "appshotShutterFade"
        )
        animateOpacity(
            layer: snapshotImageLayer,
            values: [0, 1, 1],
            keyTimes: [0, transitionStyle.snapshotFadeInProgress, 1],
            duration: duration,
            key: "appshotSnapshotFadeIn"
        )
        animateOpacity(
            layer: appIconLayer,
            values: [0, 0, 1, 0],
            keyTimes: [0, transitionStyle.appIconFadeStartProgress, transitionStyle.appIconVisibleProgress, 1],
            duration: duration,
            key: "appshotAppIconFadeIn"
        )
        animateOpacity(
            layer: titleLayer,
            values: [0, 0, 1, 0],
            keyTimes: [0, transitionStyle.titleFadeStartProgress, transitionStyle.titleVisibleProgress, 1],
            duration: duration,
            key: "appshotTitleFadeIn"
        )

        let maskPathAnimation = CABasicAnimation(keyPath: "path")
        maskPathAnimation.fromValue = CGPath(
            roundedRect: CGRect(origin: .zero, size: startFrame.size),
            cornerWidth: target.destinationCornerRadius,
            cornerHeight: target.destinationCornerRadius,
            transform: nil
        )
        maskPathAnimation.toValue = finalMaskPath
        maskPathAnimation.duration = duration
        maskPathAnimation.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
        snapshotMaskLayer.path = finalMaskPath
        snapshotMaskLayer.add(maskPathAnimation, forKey: "appshotSnapshotMask")

        snapshotEffectsLayer.frame = endFrame
        destinationShadowLayer.frame = endFrame
        keyShadowLayer.frame = endFrame
        ambientShadowLayer.frame = endFrame
        CATransaction.commit()
    }

    private func configureLayers(screenshotPath: String) {
        guard let rootLayer = layer else { return }
        rootLayer.masksToBounds = false

        transitionBackgroundLayer.frame = bounds
        transitionBackgroundLayer.backgroundColor = NSColor.black.withAlphaComponent(transitionStyle.transitionBackgroundOpacity).cgColor
        transitionBackgroundLayer.opacity = 0
        rootLayer.addSublayer(transitionBackgroundLayer)

        shutterLayer.frame = bounds
        shutterLayer.backgroundColor = NSColor.white.cgColor
        shutterLayer.opacity = 0
        rootLayer.addSublayer(shutterLayer)

        configureShadowLayer(
            destinationShadowLayer,
            radius: transitionStyle.destinationShadowRadius,
            yOffset: transitionStyle.destinationShadowYOffset,
            opacity: transitionStyle.destinationShadowOpacity
        )
        configureShadowLayer(
            keyShadowLayer,
            radius: transitionStyle.keyShadowRadius,
            yOffset: transitionStyle.keyShadowYOffset,
            opacity: transitionStyle.keyShadowOpacity
        )
        configureShadowLayer(
            ambientShadowLayer,
            radius: transitionStyle.ambientShadowRadius,
            yOffset: transitionStyle.ambientShadowYOffset,
            opacity: transitionStyle.ambientShadowOpacity
        )
        rootLayer.addSublayer(ambientShadowLayer)
        rootLayer.addSublayer(keyShadowLayer)
        rootLayer.addSublayer(destinationShadowLayer)

        snapshotEffectsLayer.masksToBounds = true
        snapshotEffectsLayer.cornerRadius = target.destinationCornerRadius
        snapshotEffectsLayer.backgroundColor = target.destinationBackgroundColor.cgColor
        rootLayer.addSublayer(snapshotEffectsLayer)

        if let image = NSImage(contentsOfFile: screenshotPath) {
            snapshotImageLayer.contents = image
            snapshotImageLayer.contentsGravity = .resizeAspectFill
            snapshotImageLayer.contentsScale = target.displayScaleFactor
        }
        snapshotImageLayer.opacity = 0
        snapshotEffectsLayer.addSublayer(snapshotImageLayer)

        snapshotMaskLayer.fillColor = NSColor.black.cgColor
        snapshotEffectsLayer.mask = snapshotMaskLayer

        snapshotMaskDebugLayer.isHidden = true
        snapshotMaskDebugLayer.strokeColor = NSColor.systemPink.cgColor
        snapshotMaskDebugLayer.fillColor = NSColor.clear.cgColor
        snapshotEffectsLayer.addSublayer(snapshotMaskDebugLayer)

        if let appIcon {
            appIconLayer.contents = appIcon
            appIconLayer.contentsGravity = .resizeAspect
            appIconLayer.contentsScale = target.displayScaleFactor
        }
        appIconLayer.opacity = 0
        rootLayer.addSublayer(appIconLayer)

        titleLayer.string = appTitle ?? ""
        titleLayer.foregroundColor = target.destinationPrimaryTextColor.cgColor
        titleLayer.fontSize = 13
        titleLayer.alignmentMode = .center
        titleLayer.contentsScale = target.displayScaleFactor
        titleLayer.opacity = 0
        rootLayer.addSublayer(titleLayer)
    }

    private func configureShadowLayer(_ layer: CALayer, radius: CGFloat, yOffset: CGFloat, opacity: Float) {
        layer.shadowColor = NSColor.black.cgColor
        layer.shadowOffset = CGSize(width: 0, height: yOffset)
        layer.shadowRadius = radius
        layer.shadowOpacity = opacity
        layer.cornerRadius = target.destinationCornerRadius
        layer.backgroundColor = NSColor.black.withAlphaComponent(transitionStyle.shadowFillOpacity).cgColor
    }

    override func layout() {
        super.layout()
        transitionBackgroundLayer.frame = bounds
        shutterLayer.frame = bounds
        snapshotImageLayer.frame = snapshotEffectsLayer.bounds
        snapshotMaskLayer.frame = snapshotEffectsLayer.bounds
        snapshotMaskDebugLayer.frame = snapshotEffectsLayer.bounds
        let centerY = bounds.height - 64
        let iconSize = transitionStyle.accessoryIconSize
        appIconLayer.frame = CGRect(
            x: bounds.midX - iconSize / 2,
            y: centerY + transitionStyle.accessoryIconYOffset,
            width: iconSize,
            height: iconSize
        )
        titleLayer.frame = CGRect(x: 0, y: centerY + transitionStyle.accessoryTitleYOffset, width: bounds.width, height: 24)
    }

    private func readStartFrame() -> CGRect {
        let source = target.appKitSourceWindowFrame
        return CGRect(
            x: source.minX - target.appKitDisplayFrame.minX,
            y: source.minY - target.appKitDisplayFrame.minY,
            width: source.width,
            height: source.height
        )
    }

    private func readEndFrame() -> CGRect {
        let destination = target.appKitDestinationFrame
        let height = transitionSnapshotHeight.flatMap { value -> CGFloat? in
            guard value.isFinite, value > 0 else { return nil }
            return value
        } ?? target.destinationFrame.height
        return CGRect(
            x: destination.minX - target.appKitDisplayFrame.minX,
            y: destination.midY - target.appKitDisplayFrame.minY - height / 2,
            width: destination.width,
            height: height
        )
    }

    private func animateSpringFrame(
        layer: CALayer,
        from: CGRect,
        to: CGRect,
        response: Double,
        dampingFraction: Double,
        duration: TimeInterval,
        key: String
    ) {
        guard response.isFinite, response > 0, dampingFraction.isFinite, dampingFraction > 0 else {
            animateFrame(layer: layer, from: from, to: to, duration: duration, key: key)
            return
        }

        let angularFrequency = (2 * Double.pi) / response
        let animation = CASpringAnimation(keyPath: "frame")
        animation.mass = 1
        animation.stiffness = angularFrequency * angularFrequency
        animation.damping = 2 * dampingFraction * angularFrequency
        animation.initialVelocity = 0
        animation.fromValue = from
        animation.toValue = to
        animation.duration = duration
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(animation, forKey: key)
    }

    private func animateFrame(layer: CALayer, from: CGRect, to: CGRect, duration: TimeInterval, key: String) {
        let animation = CABasicAnimation(keyPath: "frame")
        animation.fromValue = from
        animation.toValue = to
        animation.duration = duration
        animation.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
        layer.add(animation, forKey: key)
    }

    private func animateOpacity(layer: CALayer, values: [Float], keyTimes: [NSNumber], duration: TimeInterval, key: String) {
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = values
        animation.keyTimes = keyTimes
        animation.duration = duration
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.opacity = values.last ?? layer.opacity
        layer.add(animation, forKey: key)
    }

    func readPresentationProbeSample(outputDir: String, index: Int) throws -> [String: Any] {
        layoutSubtreeIfNeeded()
        let imagePath = (outputDir as NSString).appendingPathComponent("appshot-presentation-sample-\(String(format: "%03d", index)).png")
        var imageStatus = "missing"
        if let rootLayer = layer {
            let image = try renderPresentationImage(rootLayer: rootLayer)
            try writeProbePNGImage(image, filePath: imagePath)
            imageStatus = "written"
        }
        return [
            "index": index,
            "capturedAt": isoTimestamp(),
            "imagePath": imageStatus == "written" ? imagePath : NSNull(),
            "imageStatus": imageStatus,
            "transitionBackgroundOpacity": Double(readPresentationOpacity(transitionBackgroundLayer)),
            "shutterOpacity": Double(readPresentationOpacity(shutterLayer)),
            "snapshotImageOpacity": Double(readPresentationOpacity(snapshotImageLayer)),
            "appIconOpacity": Double(readPresentationOpacity(appIconLayer)),
            "titleOpacity": Double(readPresentationOpacity(titleLayer)),
            "snapshotFrame": serialize(rect: readPresentationFrame(snapshotEffectsLayer)),
            "destinationShadowFrame": serialize(rect: readPresentationFrame(destinationShadowLayer)),
            "keyShadowFrame": serialize(rect: readPresentationFrame(keyShadowLayer)),
            "ambientShadowFrame": serialize(rect: readPresentationFrame(ambientShadowLayer)),
            "modelSnapshotFrame": serialize(rect: snapshotEffectsLayer.frame),
            "modelDestinationShadowFrame": serialize(rect: destinationShadowLayer.frame),
            "modelKeyShadowFrame": serialize(rect: keyShadowLayer.frame),
            "modelAmbientShadowFrame": serialize(rect: ambientShadowLayer.frame),
        ]
    }

    private func renderPresentationImage(rootLayer: CALayer) throws -> CGImage {
        let scale = max(target.displayScaleFactor, 1)
        let pixelWidth = max(Int(ceil(bounds.width * scale)), 1)
        let pixelHeight = max(Int(ceil(bounds.height * scale)), 1)
        guard let context = CGContext(
            data: nil,
            width: pixelWidth,
            height: pixelHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw BridgeError("appshot-presentation-context-unavailable", "Could not create Appshot presentation render context.")
        }
        context.scaleBy(x: scale, y: scale)
        (rootLayer.presentation() ?? rootLayer).render(in: context)
        guard let image = context.makeImage() else {
            throw BridgeError("appshot-presentation-image-unavailable", "Could not render Appshot presentation layer into an image.")
        }
        return image
    }

    private func readPresentationFrame(_ layer: CALayer) -> CGRect {
        (layer.presentation() ?? layer).frame
    }

    private func readPresentationOpacity(_ layer: CALayer) -> Float {
        (layer.presentation() ?? layer).opacity
    }
}

func copyTransitionSnapshot(from filePath: String, outputDir: String, captureId: String) -> String? {
    let snapshotPath = (outputDir as NSString).appendingPathComponent("\(captureId)-transition.png")
    do {
        if FileManager.default.fileExists(atPath: snapshotPath) {
            try FileManager.default.removeItem(atPath: snapshotPath)
        }
        try FileManager.default.copyItem(atPath: filePath, toPath: snapshotPath)
        return snapshotPath
    } catch {
        return nil
    }
}

private func readColor(_ value: String?) -> NSColor? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let hex = trimmed.hasPrefix("#") ? String(trimmed.dropFirst()) : trimmed
    guard hex.count == 6 || hex.count == 8,
          let raw = UInt64(hex, radix: 16)
    else {
        return nil
    }

    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat
    let alpha: CGFloat
    if hex.count == 8 {
        red = CGFloat((raw >> 24) & 0xff) / 255
        green = CGFloat((raw >> 16) & 0xff) / 255
        blue = CGFloat((raw >> 8) & 0xff) / 255
        alpha = CGFloat(raw & 0xff) / 255
    } else {
        red = CGFloat((raw >> 16) & 0xff) / 255
        green = CGFloat((raw >> 8) & 0xff) / 255
        blue = CGFloat(raw & 0xff) / 255
        alpha = 1
    }
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
}

private func readFiniteDouble(_ raw: Any?) -> Double? {
    guard let number = raw as? NSNumber else { return nil }
    let value = number.doubleValue
    guard value.isFinite else { return nil }
    return value
}

private func readNonnegativeDouble(_ raw: Any?) -> Double? {
    guard let value = readFiniteDouble(raw), value >= 0 else { return nil }
    return value
}

private func readPositiveDouble(_ raw: Any?) -> Double? {
    guard let value = readFiniteDouble(raw), value > 0 else { return nil }
    return value
}

private func readUnitDouble(_ raw: Any?) -> Double? {
    guard let value = readFiniteDouble(raw), value >= 0, value <= 1 else { return nil }
    return value
}
