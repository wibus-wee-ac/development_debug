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
    let transitionGeometry: [String: Any]

    func serialize() -> [String: Any] {
        [
            "strategy": "cradle-native",
            "animationDuration": animationDuration,
            "transitionSnapshotPath": transitionSnapshotPath ?? NSNull(),
            "transitionSnapshotHeight": transitionSnapshotHeight ?? NSNull(),
            "transitionSpringDampingFraction": transitionSpringDampingFraction ?? NSNull(),
            "transitionSpringResponse": transitionSpringResponse ?? NSNull(),
            "transitionGeometry": transitionGeometry,
        ]
    }
}

struct AppshotTransitionCalibration {
    let animationDuration: TimeInterval
    let transitionSnapshotHeight: Double?
    let springResponse: Double
    let springDampingFraction: Double

    static func from(
        params: [String: Any],
        target: AppshotTransitionTarget,
        windowTitle: String? = nil,
        appName: String? = nil
    ) -> AppshotTransitionCalibration {
        let animationDuration = readPositiveDouble(params["animationDuration"]) ?? AppshotTransitionTiming.animationDuration
        let transitionSnapshotHeight = readPositiveDouble(params["transitionSnapshotHeight"]).map { $0 / Double(target.transitionSnapshotScale) }
            ?? AppshotTransitionCalibration.defaultTransitionSnapshotHeight(
                windowTitle: windowTitle,
                appName: appName,
                scale: target.transitionSnapshotScale
            )
        let springResponse = readPositiveDouble(params["transitionSpringResponse"]) ?? AppshotTransitionTiming.placeholderSpringResponse
        let springDampingFraction = readPositiveDouble(params["transitionSpringDampingFraction"]) ?? AppshotTransitionTiming.placeholderSpringDampingFraction
        return AppshotTransitionCalibration(
            animationDuration: animationDuration,
            transitionSnapshotHeight: transitionSnapshotHeight,
            springResponse: springResponse,
            springDampingFraction: springDampingFraction
        )
    }

    private static func defaultTransitionSnapshotHeight(windowTitle: String?, appName: String?, scale: CGFloat) -> Double {
        let title = windowTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let name = appName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if title.isEmpty && name.isEmpty {
            return AppshotLayerMetrics.transitionSnapshotBaseHeight
        }
        let resolvedScale = max(Double(scale), 1)
        return AppshotLayerMetrics.titledTransitionSnapshotBaseHeight
            + ceil(AppshotLayerMetrics.titleLineHeight * resolvedScale) / resolvedScale
    }
}

enum AppshotTransitionTiming {
    static let animationDuration: TimeInterval = 0.35
    static let completionDelay: TimeInterval = 0
    static let placeholderSpringResponse = 0.35
    static let placeholderSpringDampingFraction = 0.73
    static let backgroundFadeIn: NSNumber = 0.06
    static let backgroundFadeOut: NSNumber = 0.82
    static let shutterFadeIn: NSNumber = 0.06
    static let shutterHold: NSNumber = 0.16
    static let shutterFadeOutStart: NSNumber = 0.72
    static let shutterFadeOut: NSNumber = 1
    static let snapshotFadeIn: NSNumber = 0.72
    static let shadowFadeIn: NSNumber = 0.18
    static let appIconFadeIn: NSNumber = 0.68
    static let titleFadeIn: NSNumber = 0.72
    static func magicMoveTimingFunction() -> CAMediaTimingFunction {
        CAMediaTimingFunction(controlPoints: 0.16, 0, 0.3, 1)
    }
}

enum AppshotLayerMetrics {
    static let transitionBackgroundOpacity: Float = 0.0
    static let shutterOpacity: Float = 1.0
    static let overlayPadding: CGFloat = 96
    static let transitionSnapshotBaseHeight: Double = 140
    static let titledTransitionSnapshotBaseHeight: Double = 144
    static let titleLineHeight: Double = 16.021484375
    static let shadowOpacity: Float = 0.22
    static let shadowCornerRadius: CGFloat = 12
    static let screenshotCornerRadius: CGFloat = 12
    static let shadowRadius: CGFloat = 18
    static let shadowYOffset: CGFloat = -8
    static let appIconSize: CGFloat = 24
    static let appIconBottomInset: CGFloat = 0
    static let titleHeight: CGFloat = 18
    static let titleBottomInset: CGFloat = 8
}

struct AppshotTransitionTarget {
    let coordinateSpace: String
    let sourceWindowFrame: CGRect
    let sourceContentFrame: CGRect
    let destinationFrame: CGRect
    let destinationBackgroundColor: NSColor
    let destinationPrimaryTextColor: NSColor
    let destinationCornerRadius: CGFloat
    let transitionSnapshotScale: CGFloat
    let displayFrame: CGRect
    let displayWorkArea: CGRect
    let displayScaleFactor: CGFloat
    let displayMapping: AppshotDisplayMapping

    static func from(
        params: [String: Any],
        fallbackWindowBounds: [String: Double]?,
        captureImageSize: CaptureImageSize? = nil
    ) -> AppshotTransitionTarget {
        let sourceFrames = readSourceFrames(windowBounds: fallbackWindowBounds, captureImageSize: captureImageSize)
        if let rawTarget = params["animationTarget"] as? [String: Any],
           let rawDestinationFrame = rawTarget["destinationFrame"] as? [String: Any],
           let rawDisplay = rawTarget["codexDisplay"] as? [String: Any] {
            let scaleFactor = (rawDisplay["scaleFactor"] as? NSNumber)?.doubleValue ?? Double(NSScreen.main?.backingScaleFactor ?? 2)
            let coordinateSpace = rawTarget["coordinateSpace"] as? String ?? "screenPoints"
            let geometryScale = coordinateSpace == "pixels" ? CGFloat(max(scaleFactor, 1)) : 1
            let transitionSnapshotScale = readPositiveDouble(rawTarget["transitionSnapshotScale"]) ?? scaleFactor
            let destinationFrame = readScaledRect(rawDestinationFrame, scale: geometryScale) ?? fallbackDestinationFrame(fallbackWindowBounds)
            let displayBounds = readScaledRect(rawDisplay["bounds"] as? [String: Any], scale: geometryScale) ?? fallbackDisplayFrame(containing: destinationFrame)
            let displayWorkArea = readScaledRect(rawDisplay["workArea"] as? [String: Any], scale: geometryScale) ?? displayBounds
            let displayId = (rawDisplay["id"] as? NSNumber)?.intValue
            return AppshotTransitionTarget(
                coordinateSpace: coordinateSpace,
                sourceWindowFrame: sourceFrames.captureFrame,
                sourceContentFrame: sourceFrames.contentFrame,
                destinationFrame: destinationFrame,
                destinationBackgroundColor: readColor(rawTarget["destinationBackgroundColor"] as? String) ?? NSColor.windowBackgroundColor,
                destinationPrimaryTextColor: readColor(rawTarget["destinationPrimaryTextColor"] as? String) ?? NSColor.labelColor,
                destinationCornerRadius: CGFloat((rawTarget["destinationCornerRadius"] as? NSNumber)?.doubleValue ?? 12),
                transitionSnapshotScale: CGFloat(transitionSnapshotScale),
                displayFrame: displayBounds,
                displayWorkArea: displayWorkArea,
                displayScaleFactor: CGFloat(scaleFactor),
                displayMapping: AppshotDisplayMapping.resolve(displayId: displayId, topLeftFrame: displayBounds)
            )
        }

        let destinationFrame = fallbackDestinationFrame(fallbackWindowBounds)
        let displayFrame = fallbackDisplayFrame(containing: destinationFrame)
        return AppshotTransitionTarget(
            coordinateSpace: "screenPoints",
            sourceWindowFrame: sourceFrames.captureFrame,
            sourceContentFrame: sourceFrames.contentFrame,
            destinationFrame: destinationFrame,
            destinationBackgroundColor: NSColor.windowBackgroundColor,
            destinationPrimaryTextColor: NSColor.labelColor,
            destinationCornerRadius: 12,
            transitionSnapshotScale: NSScreen.main?.backingScaleFactor ?? 2,
            displayFrame: displayFrame,
            displayWorkArea: displayFrame,
            displayScaleFactor: NSScreen.main?.backingScaleFactor ?? 2,
            displayMapping: AppshotDisplayMapping.resolve(displayId: nil, topLeftFrame: displayFrame)
        )
    }

    var appKitSourceWindowFrame: CGRect {
        appKitRect(fromTopLeftRect: sourceWindowFrame, mapping: sourceDisplayMapping)
    }

    var appKitSourceContentFrame: CGRect {
        appKitRect(fromTopLeftRect: sourceContentFrame, mapping: sourceDisplayMapping)
    }

    var appKitDestinationFrame: CGRect {
        appKitRect(fromTopLeftRect: destinationFrame, mapping: displayMapping)
    }

    func appKitDestinationFrame(height: CGFloat) -> CGRect {
        appKitRect(
            fromTopLeftRect: CGRect(
                x: destinationFrame.minX,
                y: destinationFrame.minY,
                width: destinationFrame.width,
                height: height
            ),
            mapping: displayMapping
        )
    }

    var sourceDisplayMapping: AppshotDisplayMapping {
        AppshotDisplayMapping.containing(topLeftRect: sourceWindowFrame) ?? displayMapping
    }

    var overlayFrame: CGRect {
        appKitSourceWindowFrame
            .union(appKitDestinationFrame)
            .insetBy(dx: -AppshotLayerMetrics.overlayPadding, dy: -AppshotLayerMetrics.overlayPadding)
    }

    var overlayPanelFrames: [CGRect] {
        let screenFrames = NSScreen.screens.map(\.frame)
        let frames = screenFrames.compactMap { screenFrame -> CGRect? in
            let frame = overlayFrame.intersection(screenFrame)
            return frame.isNull || frame.isEmpty ? nil : frame
        }
        return frames.isEmpty ? [overlayFrame] : frames
    }

    func serializeTransitionGeometry() -> [String: Any] {
        let capture = appKitSourceWindowFrame
        let source = appKitSourceContentFrame
        let destination = appKitDestinationFrame
        return [
            "coordinateSpace": coordinateSpace,
            "sourceWindowFrame": serializeAppshotRect(sourceWindowFrame),
            "sourceContentFrame": serializeAppshotRect(sourceContentFrame),
            "destinationFrame": serializeAppshotRect(destinationFrame),
            "displayFrame": serializeAppshotRect(displayFrame),
            "displayWorkArea": serializeAppshotRect(displayWorkArea),
            "displayMapping": displayMapping.serialize(),
            "sourceDisplayMapping": sourceDisplayMapping.serialize(),
            "appKitDisplayFrame": serializeAppshotRect(displayMapping.appKitFrame),
            "appKitSourceDisplayFrame": serializeAppshotRect(sourceDisplayMapping.appKitFrame),
            "overlayFrame": serializeAppshotRect(overlayFrame),
            "overlayPanelFrames": overlayPanelFrames.map(serializeAppshotRect),
            "appKitSourceWindowFrame": serializeAppshotRect(capture),
            "appKitSourceContentFrame": serializeAppshotRect(source),
            "appKitDestinationFrame": serializeAppshotRect(destination),
            "overlayStartFrame": serializeAppshotRect(CGRect(
                x: source.minX - overlayFrame.minX,
                y: source.minY - overlayFrame.minY,
                width: source.width,
                height: source.height
            )),
            "overlayCaptureFrame": serializeAppshotRect(CGRect(
                x: capture.minX - overlayFrame.minX,
                y: capture.minY - overlayFrame.minY,
                width: capture.width,
                height: capture.height
            )),
            "overlayDestinationFrame": serializeAppshotRect(CGRect(
                x: destination.minX - overlayFrame.minX,
                y: destination.minY - overlayFrame.minY,
                width: destination.width,
                height: destination.height
            )),
            "overlaySourceContentFrame": serializeAppshotRect(CGRect(
                x: source.minX - overlayFrame.minX,
                y: source.minY - overlayFrame.minY,
                width: source.width,
                height: source.height
            )),
        ]
    }

    private func appKitRect(fromTopLeftRect rect: CGRect, mapping: AppshotDisplayMapping) -> CGRect {
        CGRect(
            x: mapping.appKitFrame.minX + rect.minX - mapping.topLeftFrame.minX,
            y: mapping.appKitFrame.minY + mapping.topLeftFrame.maxY - rect.maxY,
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

    private static func readScaledRect(_ raw: [String: Any]?, scale: CGFloat) -> CGRect? {
        guard let rect = readRect(raw) else {
            return nil
        }
        let divisor = max(scale, 1)
        return CGRect(
            x: rect.minX / divisor,
            y: rect.minY / divisor,
            width: rect.width / divisor,
            height: rect.height / divisor
        )
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

    private static func readSourceFrames(windowBounds: [String: Double]?, captureImageSize: CaptureImageSize?) -> (captureFrame: CGRect, contentFrame: CGRect) {
        let bounds = fallbackDestinationFrame(windowBounds)
        guard let captureImageSize else {
            return (captureFrame: bounds, contentFrame: bounds)
        }
        let scale = max(AppshotDisplayMapping.containing(topLeftRect: bounds)?.scaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2, 1)
        let captureSize = CGSize(
            width: CGFloat(captureImageSize.pixelWidth) / scale,
            height: CGFloat(captureImageSize.pixelHeight) / scale
        )
        guard abs(captureSize.width - bounds.width) > 1 || abs(captureSize.height - bounds.height) > 1 else {
            return (captureFrame: bounds, contentFrame: bounds)
        }
        let captureFrame = CGRect(
            x: bounds.midX - captureSize.width / 2,
            y: bounds.midY - captureSize.height / 2,
            width: captureSize.width,
            height: captureSize.height
        )
        return (captureFrame: captureFrame, contentFrame: bounds)
    }

    private static func fallbackDisplayFrame(containing rect: CGRect) -> CGRect {
        AppshotDisplayMapping.containing(topLeftRect: rect)?.topLeftFrame
            ?? AppshotDisplayMapping.resolve(displayId: nil, topLeftFrame: rect).topLeftFrame
    }

}

struct AppshotDisplayMapping {
    let displayId: Int?
    let topLeftFrame: CGRect
    let appKitFrame: CGRect
    let scaleFactor: CGFloat

    static func resolve(displayId: Int?, topLeftFrame: CGRect) -> AppshotDisplayMapping {
        let mappings = readMappings()
        if let displayId,
           let mapping = mappings.first(where: { $0.displayId == displayId }) {
            return mapping
        }
        if let mapping = mappings.first(where: { rectsApproximatelyEqual($0.topLeftFrame, topLeftFrame) }) {
            return mapping
        }
        if let mapping = mappings.first(where: { $0.topLeftFrame.intersects(topLeftFrame) || topLeftFrame.intersects($0.topLeftFrame) }) {
            return mapping
        }
        if let mapping = mappings.first(where: { sizesApproximatelyEqual($0.topLeftFrame.size, topLeftFrame.size) }) {
            return mapping
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        return AppshotDisplayMapping(
            displayId: readScreenDisplayId(screen),
            topLeftFrame: topLeftFrame,
            appKitFrame: screen.frame,
            scaleFactor: screen.backingScaleFactor
        )
    }

    static func containing(topLeftRect rect: CGRect) -> AppshotDisplayMapping? {
        let point = CGPoint(x: rect.midX, y: rect.midY)
        let mappings = readMappings()
        return mappings.first(where: { $0.topLeftFrame.contains(point) })
            ?? mappings.first(where: { $0.topLeftFrame.intersects(rect) })
    }

    static func readMappings() -> [AppshotDisplayMapping] {
        NSScreen.screens.map { screen in
            let displayId = readScreenDisplayId(screen)
            let topLeftFrame = displayId
                .map { CGRect(origin: CGDisplayBounds(CGDirectDisplayID($0)).origin, size: CGDisplayBounds(CGDirectDisplayID($0)).size) }
                .flatMap { $0.isNull || $0.isEmpty ? nil : $0 }
                ?? screen.frame
            return AppshotDisplayMapping(
                displayId: displayId,
                topLeftFrame: topLeftFrame,
                appKitFrame: screen.frame,
                scaleFactor: screen.backingScaleFactor
            )
        }
    }

    func serialize() -> [String: Any] {
        [
            "displayId": displayId ?? NSNull(),
            "topLeftFrame": serializeAppshotRect(topLeftFrame),
            "appKitFrame": serializeAppshotRect(appKitFrame),
            "scaleFactor": Double(scaleFactor),
        ]
    }

    private static func rectsApproximatelyEqual(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 1
            && abs(lhs.minY - rhs.minY) < 1
            && abs(lhs.width - rhs.width) < 1
            && abs(lhs.height - rhs.height) < 1
    }

    private static func sizesApproximatelyEqual(_ lhs: CGSize, _ rhs: CGSize) -> Bool {
        abs(lhs.width - rhs.width) < 1 && abs(lhs.height - rhs.height) < 1
    }

    private static func readScreenDisplayId(_ screen: NSScreen) -> Int? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
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
            transitionGeometry: target.serializeTransitionGeometry()
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

        let panels = target.overlayPanelFrames.map { panelFrame -> (panel: AppshotTransitionOverlayWindow, view: AppshotTransitionView) in
            let panel = AppshotTransitionOverlayWindow(frame: panelFrame)
            let view = AppshotTransitionView(
                screenshotPath: screenshotPath,
                target: target,
                viewportFrame: panelFrame,
                transitionSnapshotHeight: calibration.transitionSnapshotHeight,
                appTitle: appTitle,
                bundleIdentifier: bundleIdentifier
            )
            panel.contentView = view
            panel.setFrame(panelFrame, display: true)
            panel.orderFrontRegardless()
            view.layoutSubtreeIfNeeded()
            return (panel, view)
        }
        logTransitionPresentation(panels: panels.map(\.panel), target: target)
        if soundEnabled {
            playAppshotSound()
        }
        for entry in panels {
            entry.view.play(duration: calibration.animationDuration) {
                Task { @MainActor in
                    entry.panel.orderOut(nil)
                }
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
    private func logTransitionPresentation(panels: [NSPanel], target: AppshotTransitionTarget) {
        guard let data = try? JSONSerialization.data(withJSONObject: [
            "panels": panels.map { panel in
                [
                    "panelWindowNumber": panel.windowNumber,
                    "panelFrame": serializeAppshotRect(panel.frame),
                    "panelLevel": panel.level.rawValue,
                    "isVisible": panel.isVisible,
                ]
            },
            "displayMappings": AppshotDisplayMapping.readMappings().map { $0.serialize() },
            "geometry": target.serializeTransitionGeometry(),
        ], options: [.sortedKeys]),
            let payload = String(data: data, encoding: .utf8)
        else {
            return
        }
        FileHandle.standardError.write(Data("[appshot-transition] \(payload)\n".utf8))
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
        sampleIntervalSeconds: TimeInterval,
        renderImages: Bool
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
                    sampleIntervalSeconds: sampleIntervalSeconds,
                    renderImages: renderImages
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

        let panel = AppshotTransitionOverlayWindow(frame: target.overlayFrame)
        let view = AppshotTransitionView(
            screenshotPath: screenshotPath,
            target: target,
            viewportFrame: target.overlayFrame,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        panel.contentView = view
        panel.orderFrontRegardless()
        view.layoutSubtreeIfNeeded()

        view.play(duration: calibration.animationDuration) {}

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
            "transitionGeometry": target.serializeTransitionGeometry(),
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
        sampleIntervalSeconds: TimeInterval,
        renderImages: Bool
    ) async throws -> [String: Any] {
        try FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let panel = AppshotTransitionOverlayWindow(frame: target.overlayFrame)
        let view = AppshotTransitionView(
            screenshotPath: screenshotPath,
            target: target,
            viewportFrame: target.overlayFrame,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        panel.contentView = view
        panel.orderFrontRegardless()
        view.layoutSubtreeIfNeeded()

        view.play(duration: calibration.animationDuration) {}

        var samples: [[String: Any]] = []
        let startedAt = CFAbsoluteTimeGetCurrent()
        for index in 0..<max(sampleCount, 1) {
            if index > 0 {
                try await Task.sleep(nanoseconds: UInt64(max(sampleIntervalSeconds, 0.01) * 1_000_000_000))
            }
            samples.append(try view.readPresentationProbeSample(
                outputDir: outputDir,
                index: index,
                startedAt: startedAt,
                renderImage: renderImages
            ))
        }

        panel.orderOut(nil)
        return [
            "panelWindowNumber": panel.windowNumber,
            "sampleCount": samples.count,
            "sampleIntervalSeconds": sampleIntervalSeconds,
            "animationDuration": calibration.animationDuration,
            "transitionGeometry": target.serializeTransitionGeometry(),
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

private func serializeAppshotRect(_ rect: CGRect) -> [String: Double] {
    [
        "x": Double(rect.origin.x),
        "y": Double(rect.origin.y),
        "width": Double(rect.size.width),
        "height": Double(rect.size.height),
    ]
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
                target.overlayFrame,
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
        "captureRect": serialize(rect: target.overlayFrame),
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
    init(frame: CGRect) {
        super.init(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        level = .screenSaver
        ignoresMouseEvents = true
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class AppshotTransitionView: NSView {
    private let target: AppshotTransitionTarget
    private let viewportFrame: CGRect
    private let transitionSnapshotHeight: CGFloat?
    private let appTitle: String?
    private let bundleIdentifier: String?
    private let contentLayer = CALayer()
    private let transitionBackgroundLayer = CALayer()
    private let shadowLayer = CALayer()
    private let containerLayer = CALayer()
    private let shutterLayer = CALayer()
    private let snapshotEffectsLayer = CALayer()
    private let snapshotImageLayer = CALayer()
    private let snapshotMaskLayer = CAShapeLayer()
    private let snapshotMaskDebugLayer = CAShapeLayer()
    private let appIconLayer = CALayer()
    private let titleLayer = CATextLayer()
    private var didStartTransition = false

    init(
        screenshotPath: String,
        target: AppshotTransitionTarget,
        viewportFrame: CGRect,
        transitionSnapshotHeight: Double?,
        appTitle: String?,
        bundleIdentifier: String?
    ) {
        self.target = target
        self.viewportFrame = viewportFrame
        self.transitionSnapshotHeight = transitionSnapshotHeight.map { CGFloat($0) }
        self.appTitle = appTitle
        self.bundleIdentifier = bundleIdentifier
        super.init(frame: CGRect(origin: .zero, size: viewportFrame.size))
        wantsLayer = true
        configureLayers(screenshotPath: screenshotPath)
    }

    required init?(coder: NSCoder) {
        nil
    }

    func play(duration: TimeInterval, completion: @escaping @Sendable () -> Void) {
        let startFrame = readStartFrame()
        let startCaptureFrame = readStartCaptureFrame()
        let startSnapshotImageFrame = snapshotImageStartFrame(startFrame: startFrame, captureFrame: startCaptureFrame)
        let endFrame = readEndFrame()
        let startBounds = CGRect(origin: .zero, size: startFrame.size)
        let endBounds = CGRect(origin: .zero, size: endFrame.size)
        let initialCornerRadius = readInitialCornerRadius()
        let targetCornerRadius = readTargetCornerRadius()

        didStartTransition = true
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        applyFrame(startFrame, to: shadowLayer)
        applyFrame(startFrame, to: containerLayer)
        applyFrame(startBounds, to: snapshotEffectsLayer)
        applyFrame(startSnapshotImageFrame, to: snapshotImageLayer)
        applyFrame(startBounds, to: snapshotMaskLayer)
        applyFrame(startBounds, to: snapshotMaskDebugLayer)
        applyFrame(startBounds, to: shutterLayer)
        shutterLayer.cornerRadius = initialCornerRadius
        shutterLayer.cornerCurve = .circular
        shutterLayer.opacity = 0
        snapshotEffectsLayer.cornerRadius = initialCornerRadius
        snapshotEffectsLayer.cornerCurve = .circular
        snapshotImageLayer.opacity = 0
        shadowLayer.opacity = 0
        appIconLayer.opacity = 0
        titleLayer.opacity = 0
        updateShadowPath(for: startFrame, radius: initialCornerRadius)
        updateSnapshotMaskPath(for: startBounds, radius: initialCornerRadius)
        layoutAccessoryLayers(in: startFrame)
        CATransaction.commit()

        layer?.displayIfNeeded()
        DispatchQueue.main.async {
            self.runMagicMoveTransition(
                startFrame: startFrame,
                startSnapshotImageFrame: startSnapshotImageFrame,
                endFrame: endFrame,
                startBounds: startBounds,
                endBounds: endBounds,
                initialCornerRadius: initialCornerRadius,
                targetCornerRadius: targetCornerRadius,
                duration: duration,
                completion: completion
            )
        }
    }

    private func runMagicMoveTransition(
        startFrame: CGRect,
        startSnapshotImageFrame: CGRect,
        endFrame: CGRect,
        startBounds: CGRect,
        endBounds: CGRect,
        initialCornerRadius: CGFloat,
        targetCornerRadius: CGFloat,
        duration: TimeInterval,
        completion: @escaping @Sendable () -> Void
    ) {
        let finalMaskPath = CGPath(
            roundedRect: endBounds,
            cornerWidth: targetCornerRadius,
            cornerHeight: targetCornerRadius,
            transform: nil
        )

        CATransaction.begin()
        CATransaction.setCompletionBlock {
            DispatchQueue.main.asyncAfter(deadline: .now() + AppshotTransitionTiming.completionDelay, execute: completion)
        }
        CATransaction.setDisableActions(true)
        CATransaction.setAnimationDuration(duration)
        CATransaction.setAnimationTimingFunction(AppshotTransitionTiming.magicMoveTimingFunction())

        animateFrameAfterHold(layer: containerLayer, from: startFrame, to: endFrame, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "magicMove")
        animateFrameAfterHold(layer: shadowLayer, from: startFrame, to: endFrame, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "appshotShadowMagicMove")
        animateFrameAfterHold(layer: snapshotEffectsLayer, from: startBounds, to: endBounds, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "snapshotEffectsLayer")
        animateFrameAfterHold(layer: snapshotImageLayer, from: startSnapshotImageFrame, to: endBounds, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "snapshotImageLayer")
        animateFrameAfterHold(layer: shutterLayer, from: startBounds, to: endBounds, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "appshotShutterMagicMove")
        animateAccessoryFrame(from: startFrame, to: endFrame, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration)
        animateCornerRadiusAfterHold(layer: snapshotEffectsLayer, from: initialCornerRadius, to: targetCornerRadius, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "appshotSnapshotCornerRadius")
        animateCornerRadiusAfterHold(layer: shutterLayer, from: initialCornerRadius, to: targetCornerRadius, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration, key: "appshotShutterCornerRadius")
        animateShadowPath(from: startFrame, to: endFrame, initialRadius: initialCornerRadius, targetRadius: targetCornerRadius, holdUntil: AppshotTransitionTiming.shutterHold, duration: duration)
        animateOpacity(
            layer: transitionBackgroundLayer,
            values: [0, AppshotLayerMetrics.transitionBackgroundOpacity, AppshotLayerMetrics.transitionBackgroundOpacity, 0],
            keyTimes: [0, AppshotTransitionTiming.backgroundFadeIn, AppshotTransitionTiming.backgroundFadeOut, 1],
            duration: duration,
            key: "appshotBackgroundFade"
        )
        animateOpacity(
            layer: shutterLayer,
            values: [0, AppshotLayerMetrics.shutterOpacity, AppshotLayerMetrics.shutterOpacity, 0],
            keyTimes: [0, AppshotTransitionTiming.shutterFadeIn, AppshotTransitionTiming.shutterFadeOutStart, AppshotTransitionTiming.shutterFadeOut],
            duration: duration,
            key: "appshotShutterFadeInOut"
        )
        animateDelayedOpacity(
            layer: shadowLayer,
            from: 0,
            to: AppshotLayerMetrics.shadowOpacity,
            startProgress: AppshotTransitionTiming.shadowFadeIn,
            duration: duration,
            key: "appshotShadowFadeIn"
        )
        animateDelayedOpacity(
            layer: snapshotImageLayer,
            from: 0,
            to: 1,
            startProgress: AppshotTransitionTiming.snapshotFadeIn,
            duration: duration,
            key: "appshotSnapshotFadeIn"
        )
        animateDelayedOpacity(
            layer: appIconLayer,
            from: 0,
            to: appIconLayer.contents == nil ? 0 : 1,
            startProgress: AppshotTransitionTiming.appIconFadeIn,
            duration: duration,
            key: "appshotAppIconFadeIn"
        )
        animateDelayedOpacity(
            layer: titleLayer,
            from: 0,
            to: readTitleText().isEmpty ? 0 : 1,
            startProgress: AppshotTransitionTiming.titleFadeIn,
            duration: duration,
            key: "appshotTitleFadeIn"
        )

        let initialMaskPath = CGPath(
            roundedRect: startBounds,
            cornerWidth: initialCornerRadius,
            cornerHeight: initialCornerRadius,
            transform: nil
        )
        let maskPathAnimation = CAKeyframeAnimation(keyPath: "path")
        maskPathAnimation.keyTimes = [0, AppshotTransitionTiming.shutterHold, 1]
        maskPathAnimation.values = [initialMaskPath, initialMaskPath, finalMaskPath]
        maskPathAnimation.duration = duration
        maskPathAnimation.timingFunctions = [
            CAMediaTimingFunction(name: .linear),
            AppshotTransitionTiming.magicMoveTimingFunction(),
        ]
        snapshotMaskLayer.path = finalMaskPath
        snapshotMaskLayer.add(maskPathAnimation, forKey: "appshotSnapshotMask")

        applyFrame(endFrame, to: shadowLayer)
        applyFrame(endFrame, to: containerLayer)
        applyFrame(endBounds, to: snapshotEffectsLayer)
        applyFrame(endBounds, to: snapshotImageLayer)
        applyFrame(endBounds, to: snapshotMaskLayer)
        applyFrame(endBounds, to: snapshotMaskDebugLayer)
        applyFrame(endBounds, to: shutterLayer)
        updateShadowPath(for: endFrame, radius: targetCornerRadius)
        updateSnapshotMaskPath(for: endBounds, radius: targetCornerRadius)
        layoutAccessoryLayers(in: endFrame)
        shutterLayer.cornerRadius = targetCornerRadius
        snapshotEffectsLayer.cornerRadius = targetCornerRadius
        shutterLayer.opacity = 0
        snapshotImageLayer.opacity = 1
        shadowLayer.opacity = AppshotLayerMetrics.shadowOpacity
        appIconLayer.opacity = appIconLayer.contents == nil ? 0 : 1
        titleLayer.opacity = readTitleText().isEmpty ? 0 : 1
        CATransaction.commit()
    }

    private func configureLayers(screenshotPath: String) {
        guard let rootLayer = layer else { return }
        rootLayer.masksToBounds = false
        rootLayer.backgroundColor = NSColor.clear.cgColor

        contentLayer.frame = bounds
        contentLayer.masksToBounds = false
        contentLayer.backgroundColor = NSColor.clear.cgColor
        rootLayer.addSublayer(contentLayer)

        transitionBackgroundLayer.frame = bounds
        transitionBackgroundLayer.backgroundColor = NSColor.clear.cgColor
        transitionBackgroundLayer.opacity = 0
        contentLayer.addSublayer(transitionBackgroundLayer)

        shadowLayer.frame = .zero
        shadowLayer.backgroundColor = NSColor.clear.cgColor
        shadowLayer.shadowColor = NSColor.black.cgColor
        shadowLayer.shadowOpacity = AppshotLayerMetrics.shadowOpacity
        shadowLayer.shadowRadius = AppshotLayerMetrics.shadowRadius
        shadowLayer.shadowOffset = CGSize(width: 0, height: AppshotLayerMetrics.shadowYOffset)
        shadowLayer.opacity = 0
        contentLayer.addSublayer(shadowLayer)

        containerLayer.masksToBounds = false
        contentLayer.addSublayer(containerLayer)

        snapshotEffectsLayer.masksToBounds = true
        snapshotEffectsLayer.cornerRadius = AppshotLayerMetrics.screenshotCornerRadius
        snapshotEffectsLayer.cornerCurve = .circular
        snapshotEffectsLayer.backgroundColor = NSColor.clear.cgColor
        containerLayer.addSublayer(snapshotEffectsLayer)

        if let image = NSImage(contentsOfFile: screenshotPath) {
            var proposedRect = CGRect(origin: .zero, size: image.size)
            snapshotImageLayer.contents = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil)
            snapshotImageLayer.contentsGravity = .resizeAspectFill
            snapshotImageLayer.contentsScale = target.displayScaleFactor
            snapshotImageLayer.magnificationFilter = .linear
            snapshotImageLayer.minificationFilter = .trilinear
        }
        snapshotImageLayer.opacity = 0
        snapshotEffectsLayer.addSublayer(snapshotImageLayer)

        shutterLayer.frame = .zero
        shutterLayer.backgroundColor = NSColor.white.cgColor
        shutterLayer.opacity = AppshotLayerMetrics.shutterOpacity
        shutterLayer.masksToBounds = true
        shutterLayer.cornerRadius = AppshotLayerMetrics.screenshotCornerRadius
        shutterLayer.cornerCurve = .circular
        snapshotEffectsLayer.addSublayer(shutterLayer)

        snapshotMaskLayer.fillColor = NSColor.black.cgColor
        snapshotEffectsLayer.mask = snapshotMaskLayer

        snapshotMaskDebugLayer.isHidden = true
        snapshotMaskDebugLayer.strokeColor = NSColor.systemPink.cgColor
        snapshotMaskDebugLayer.fillColor = NSColor.clear.cgColor
        snapshotEffectsLayer.addSublayer(snapshotMaskDebugLayer)

        if let icon = readApplicationIconImage(bundleIdentifier: bundleIdentifier) {
            var proposedRect = CGRect(origin: .zero, size: icon.size)
            appIconLayer.contents = icon.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil)
            appIconLayer.contentsGravity = .resizeAspect
            appIconLayer.contentsScale = target.displayScaleFactor
            appIconLayer.magnificationFilter = .linear
            appIconLayer.minificationFilter = .trilinear
        }
        appIconLayer.opacity = 0
        contentLayer.addSublayer(appIconLayer)

        titleLayer.string = readTitleText()
        titleLayer.foregroundColor = target.destinationPrimaryTextColor.cgColor
        titleLayer.fontSize = 13
        titleLayer.alignmentMode = .center
        titleLayer.truncationMode = .end
        titleLayer.contentsScale = target.displayScaleFactor
        titleLayer.opacity = 0
        contentLayer.addSublayer(titleLayer)
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        contentLayer.frame = bounds
        transitionBackgroundLayer.frame = bounds
        if !didStartTransition {
            applyFrame(containerLayer.bounds, to: snapshotEffectsLayer)
            applyFrame(snapshotEffectsLayer.bounds, to: snapshotImageLayer)
            applyFrame(snapshotEffectsLayer.bounds, to: snapshotMaskLayer)
            applyFrame(snapshotEffectsLayer.bounds, to: snapshotMaskDebugLayer)
        }
        CATransaction.commit()
    }

    private func readStartFrame() -> CGRect {
        let source = target.appKitSourceContentFrame
        return CGRect(
            x: source.minX - viewportFrame.minX,
            y: source.minY - viewportFrame.minY,
            width: source.width,
            height: source.height
        )
    }

    private func readStartCaptureFrame() -> CGRect {
        let source = target.appKitSourceWindowFrame
        return CGRect(
            x: source.minX - viewportFrame.minX,
            y: source.minY - viewportFrame.minY,
            width: source.width,
            height: source.height
        )
    }

    private func readEndFrame() -> CGRect {
        let height = transitionSnapshotHeight.flatMap { value -> CGFloat? in
            guard value.isFinite, value > 0 else { return nil }
            return value
        } ?? target.destinationFrame.height
        let destination = target.appKitDestinationFrame(height: height)
        return CGRect(
            x: destination.minX - viewportFrame.minX,
            y: destination.minY - viewportFrame.minY,
            width: destination.width,
            height: height
        )
    }

    private func applyFrame(_ frame: CGRect, to layer: CALayer) {
        layer.bounds = CGRect(origin: .zero, size: frame.size)
        layer.position = CGPoint(x: frame.midX, y: frame.midY)
    }

    private func snapshotImageStartFrame(startFrame: CGRect, captureFrame: CGRect) -> CGRect {
        guard captureFrame.width > 0, captureFrame.height > 0 else {
            return CGRect(origin: .zero, size: startFrame.size)
        }
        return CGRect(
            x: captureFrame.minX - startFrame.minX,
            y: captureFrame.minY - startFrame.minY,
            width: captureFrame.width,
            height: captureFrame.height
        )
    }

    private func sourceContentBounds(in startFrame: CGRect, contentFrame: CGRect) -> CGRect {
        guard startFrame.width > 0,
              startFrame.height > 0,
              contentFrame.width > 0,
              contentFrame.height > 0
        else {
            return CGRect(origin: .zero, size: startFrame.size)
        }
        return CGRect(
            x: contentFrame.minX - startFrame.minX,
            y: contentFrame.minY - startFrame.minY,
            width: min(contentFrame.width, startFrame.width),
            height: min(contentFrame.height, startFrame.height)
        )
    }

    private func readInitialCornerRadius() -> CGFloat {
        AppshotLayerMetrics.screenshotCornerRadius
    }

    private func readTargetCornerRadius() -> CGFloat {
        max(target.destinationCornerRadius, 0)
    }

    private func updateShadowPath(for frame: CGRect, radius: CGFloat) {
        shadowLayer.shadowPath = CGPath(
            roundedRect: CGRect(origin: .zero, size: frame.size),
            cornerWidth: radius,
            cornerHeight: radius,
            transform: nil
        )
    }

    private func updateSnapshotMaskPath(for bounds: CGRect, radius: CGFloat) {
        snapshotMaskLayer.path = CGPath(
            roundedRect: bounds,
            cornerWidth: radius,
            cornerHeight: radius,
            transform: nil
        )
        snapshotMaskDebugLayer.path = snapshotMaskLayer.path
    }

    private func layoutAccessoryLayers(in frame: CGRect) {
        let iconSize = AppshotLayerMetrics.appIconSize
        appIconLayer.frame = CGRect(
            x: frame.midX - iconSize / 2,
            y: frame.minY + AppshotLayerMetrics.appIconBottomInset,
            width: iconSize,
            height: iconSize
        )
        titleLayer.frame = CGRect(
            x: frame.minX + 8,
            y: frame.minY + iconSize + AppshotLayerMetrics.titleBottomInset,
            width: max(frame.width - 16, 0),
            height: AppshotLayerMetrics.titleHeight
        )
    }

    private func readTitleText() -> String {
        appTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func animateFrameAfterHold(
        layer: CALayer,
        from: CGRect,
        to: CGRect,
        holdUntil: NSNumber,
        duration: TimeInterval,
        key: String
    ) {
        animateValueAfterHold(
            layer: layer,
            keyPath: "position",
            values: [
                CGPoint(x: from.midX, y: from.midY),
                CGPoint(x: from.midX, y: from.midY),
                CGPoint(x: to.midX, y: to.midY),
            ],
            holdUntil: holdUntil,
            duration: duration,
            key: "\(key).position"
        )
        animateValueAfterHold(
            layer: layer,
            keyPath: "bounds",
            values: [
                CGRect(origin: .zero, size: from.size),
                CGRect(origin: .zero, size: from.size),
                CGRect(origin: .zero, size: to.size),
            ],
            holdUntil: holdUntil,
            duration: duration,
            key: "\(key).bounds"
        )
    }

    private func animateValueAfterHold(layer: CALayer, keyPath: String, values: [Any], holdUntil: NSNumber, duration: TimeInterval, key: String) {
        let animation = CAKeyframeAnimation(keyPath: keyPath)
        animation.values = values
        animation.keyTimes = [0, holdUntil, 1]
        animation.duration = duration
        animation.timingFunctions = [
            CAMediaTimingFunction(name: .linear),
            AppshotTransitionTiming.magicMoveTimingFunction(),
        ]
        layer.add(animation, forKey: key)
    }

    private func animateShadowPath(
        from: CGRect,
        to: CGRect,
        initialRadius: CGFloat,
        targetRadius: CGFloat,
        holdUntil: NSNumber,
        duration: TimeInterval
    ) {
        let initialPath = CGPath(
            roundedRect: CGRect(origin: .zero, size: from.size),
            cornerWidth: initialRadius,
            cornerHeight: initialRadius,
            transform: nil
        )
        let targetPath = CGPath(
            roundedRect: CGRect(origin: .zero, size: to.size),
            cornerWidth: targetRadius,
            cornerHeight: targetRadius,
            transform: nil
        )
        let animation = CAKeyframeAnimation(keyPath: "shadowPath")
        animation.values = [initialPath, initialPath, targetPath]
        animation.keyTimes = [0, holdUntil, 1]
        animation.duration = duration
        animation.timingFunctions = [
            CAMediaTimingFunction(name: .linear),
            AppshotTransitionTiming.magicMoveTimingFunction(),
        ]
        shadowLayer.add(animation, forKey: "appshotShadowPath")
    }

    private func animateCornerRadiusAfterHold(
        layer: CALayer,
        from: CGFloat,
        to: CGFloat,
        holdUntil: NSNumber,
        duration: TimeInterval,
        key: String
    ) {
        animateValueAfterHold(
            layer: layer,
            keyPath: "cornerRadius",
            values: [from, from, to],
            holdUntil: holdUntil,
            duration: duration,
            key: key
        )
        layer.cornerRadius = to
    }

    private func animateAccessoryFrame(from: CGRect, to: CGRect, holdUntil: NSNumber, duration: TimeInterval) {
        let fromIconFrame = accessoryIconFrame(in: from)
        let toIconFrame = accessoryIconFrame(in: to)
        animateFrameAfterHold(
            layer: appIconLayer,
            from: fromIconFrame,
            to: toIconFrame,
            holdUntil: holdUntil,
            duration: duration,
            key: "appshotAppIconMagicMove"
        )

        let fromTitleFrame = accessoryTitleFrame(in: from)
        let toTitleFrame = accessoryTitleFrame(in: to)
        animateFrameAfterHold(
            layer: titleLayer,
            from: fromTitleFrame,
            to: toTitleFrame,
            holdUntil: holdUntil,
            duration: duration,
            key: "appshotTitleMagicMove"
        )
    }

    private func accessoryIconFrame(in frame: CGRect) -> CGRect {
        let iconSize = AppshotLayerMetrics.appIconSize
        return CGRect(
            x: frame.midX - iconSize / 2,
            y: frame.minY + AppshotLayerMetrics.appIconBottomInset,
            width: iconSize,
            height: iconSize
        )
    }

    private func accessoryTitleFrame(in frame: CGRect) -> CGRect {
        let iconSize = AppshotLayerMetrics.appIconSize
        return CGRect(
            x: frame.minX + 8,
            y: frame.minY + iconSize + AppshotLayerMetrics.titleBottomInset,
            width: max(frame.width - 16, 0),
            height: AppshotLayerMetrics.titleHeight
        )
    }

    private func animateDelayedOpacity(
        layer: CALayer,
        from: Float,
        to: Float,
        startProgress: NSNumber,
        duration: TimeInterval,
        key: String
    ) {
        let start = max(0, min(startProgress.doubleValue, 0.99))
        let beginTime = layer.convertTime(CACurrentMediaTime(), from: nil) + duration * start
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = from
        animation.toValue = to
        animation.beginTime = beginTime
        animation.duration = max(duration * (1 - start), 0.001)
        animation.fillMode = .backwards
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.opacity = to
        layer.add(animation, forKey: key)
    }

    private func animateOpacity(layer: CALayer, values: [Float], keyTimes: [NSNumber], duration: TimeInterval, key: String) {
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = values
        animation.keyTimes = keyTimes
        animation.duration = duration
        animation.calculationMode = .linear
        animation.timingFunctions = values.dropFirst().map { _ in CAMediaTimingFunction(name: .easeInEaseOut) }
        layer.opacity = values.last ?? layer.opacity
        layer.add(animation, forKey: key)
    }

    func readPresentationProbeSample(
        outputDir: String,
        index: Int,
        startedAt: CFAbsoluteTime,
        renderImage: Bool
    ) throws -> [String: Any] {
        layoutSubtreeIfNeeded()
        let imagePath = (outputDir as NSString).appendingPathComponent("appshot-presentation-sample-\(String(format: "%03d", index)).png")
        var imageStatus = renderImage ? "missing" : "skipped"
        if renderImage, let rootLayer = layer {
            let image = try renderPresentationImage(rootLayer: rootLayer)
            try writeProbePNGImage(image, filePath: imagePath)
            imageStatus = "written"
        }
        return [
            "index": index,
            "capturedAt": isoTimestamp(),
            "elapsedSeconds": CFAbsoluteTimeGetCurrent() - startedAt,
            "imagePath": imageStatus == "written" ? imagePath : NSNull(),
            "imageStatus": imageStatus,
            "transitionBackgroundOpacity": Double(readPresentationOpacity(transitionBackgroundLayer)),
            "shutterOpacity": Double(readPresentationOpacity(shutterLayer)),
            "coverOpacity": Double(readPresentationOpacity(shutterLayer)),
            "snapshotImageOpacity": Double(readPresentationOpacity(snapshotImageLayer)),
            "shadowOpacity": Double(readPresentationOpacity(shadowLayer)),
            "appIconOpacity": Double(readPresentationOpacity(appIconLayer)),
            "titleOpacity": Double(readPresentationOpacity(titleLayer)),
            "shutterCornerRadius": Double(readPresentationCornerRadius(shutterLayer)),
            "coverCornerRadius": Double(readPresentationCornerRadius(shutterLayer)),
            "snapshotCornerRadius": Double(readPresentationCornerRadius(snapshotEffectsLayer)),
            "shadowCornerRadius": Double(AppshotLayerMetrics.shadowCornerRadius),
            "screenshotCornerRadius": Double(AppshotLayerMetrics.screenshotCornerRadius),
            "initialCornerRadius": Double(readInitialCornerRadius()),
            "targetCornerRadius": Double(readTargetCornerRadius()),
            "coverBackgroundColor": serializeColor(shutterLayer.backgroundColor),
            "shutterBackgroundColor": serializeColor(shutterLayer.backgroundColor),
            "snapshotBackgroundColor": serializeColor(snapshotEffectsLayer.backgroundColor),
            "snapshotImageHasContents": snapshotImageLayer.contents != nil,
            "snapshotImageContentsScale": Double(snapshotImageLayer.contentsScale),
            "expectedStartFrame": serialize(rect: readStartFrame()),
            "expectedStartCaptureFrame": serialize(rect: readStartCaptureFrame()),
            "expectedStartContentFrame": serialize(rect: readStartFrame()),
            "expectedStartContentBounds": serialize(rect: sourceContentBounds(
                in: readStartFrame(),
                contentFrame: readStartFrame()
            )),
            "expectedSnapshotImageStartFrame": serialize(rect: snapshotImageStartFrame(
                startFrame: readStartFrame(),
                captureFrame: readStartCaptureFrame()
            )),
            "expectedEndFrame": serialize(rect: readEndFrame()),
            "containerFrame": serialize(rect: readPresentationFrame(containerLayer)),
            "shutterFrame": serialize(rect: readPresentationFrame(shutterLayer)),
            "coverFrame": serialize(rect: readPresentationFrame(shutterLayer)),
            "snapshotFrame": serialize(rect: readPresentationFrame(snapshotEffectsLayer)),
            "snapshotImageFrame": serialize(rect: readPresentationFrame(snapshotImageLayer)),
            "shadowFrame": serialize(rect: readPresentationFrame(shadowLayer)),
            "appIconFrame": serialize(rect: readPresentationFrame(appIconLayer)),
            "titleFrame": serialize(rect: readPresentationFrame(titleLayer)),
            "modelContainerFrame": serialize(rect: containerLayer.frame),
            "modelShutterFrame": serialize(rect: shutterLayer.frame),
            "modelCoverFrame": serialize(rect: shutterLayer.frame),
            "modelSnapshotFrame": serialize(rect: snapshotEffectsLayer.frame),
            "modelSnapshotImageFrame": serialize(rect: snapshotImageLayer.frame),
            "modelShadowFrame": serialize(rect: shadowLayer.frame),
            "modelAppIconFrame": serialize(rect: appIconLayer.frame),
            "modelTitleFrame": serialize(rect: titleLayer.frame),
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

    private func readPresentationCornerRadius(_ layer: CALayer) -> CGFloat {
        (layer.presentation() ?? layer).cornerRadius
    }

    private func serializeColor(_ color: CGColor?) -> Any {
        guard let color else {
            return NSNull()
        }
        let nsColor = NSColor(cgColor: color)?.usingColorSpace(.deviceRGB)
        guard let nsColor else {
            return NSNull()
        }
        return [
            "red": Double(nsColor.redComponent),
            "green": Double(nsColor.greenComponent),
            "blue": Double(nsColor.blueComponent),
            "alpha": Double(nsColor.alphaComponent),
        ]
    }
}

func renderTransitionSnapshot(
    from filePath: String,
    outputDir: String,
    captureId: String,
    target: AppshotTransitionTarget,
    calibration: AppshotTransitionCalibration
) -> String? {
    let snapshotPath = (outputDir as NSString).appendingPathComponent("\(captureId)-transition.png")
    do {
        if FileManager.default.fileExists(atPath: snapshotPath) {
            try FileManager.default.removeItem(atPath: snapshotPath)
        }
        guard let sourceImage = readPNGImage(filePath: filePath) else {
            return nil
        }
        let scale = max(target.transitionSnapshotScale, 1)
        let snapshotWidth = max(Int(ceil(target.destinationFrame.width * scale)), 1)
        let snapshotHeight = max(Int(ceil(CGFloat(calibration.transitionSnapshotHeight ?? Double(target.destinationFrame.height)) * scale)), 1)
        guard let context = CGContext(
            data: nil,
            width: snapshotWidth,
            height: snapshotHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }
        context.interpolationQuality = .high
        context.setFillColor(target.destinationBackgroundColor.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: snapshotWidth, height: snapshotHeight))
        context.draw(sourceImage, in: aspectFillRect(
            sourceSize: CGSize(width: sourceImage.width, height: sourceImage.height),
            targetSize: CGSize(width: snapshotWidth, height: snapshotHeight)
        ))
        guard let snapshotImage = context.makeImage() else {
            return nil
        }
        try writeProbePNGImage(snapshotImage, filePath: snapshotPath)
        return snapshotPath
    } catch {
        return nil
    }
}

private func readPNGImage(filePath: String) -> CGImage? {
    let url = URL(fileURLWithPath: filePath)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        return nil
    }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

private func aspectFillRect(sourceSize: CGSize, targetSize: CGSize) -> CGRect {
    guard sourceSize.width > 0,
          sourceSize.height > 0,
          targetSize.width > 0,
          targetSize.height > 0
    else {
        return CGRect(origin: .zero, size: targetSize)
    }
    let scale = max(targetSize.width / sourceSize.width, targetSize.height / sourceSize.height)
    let width = sourceSize.width * scale
    let height = sourceSize.height * scale
    return CGRect(
        x: (targetSize.width - width) / 2,
        y: (targetSize.height - height) / 2,
        width: width,
        height: height
    )
}

private func readApplicationIconImage(bundleIdentifier: String?) -> NSImage? {
    guard let bundleIdentifier,
          !bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
        return nil
    }
    if let application = NSRunningApplication
        .runningApplications(withBundleIdentifier: bundleIdentifier)
        .first(where: { !$0.isTerminated }),
        let icon = application.icon {
        return icon
    }
    guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
        return nil
    }
    return NSWorkspace.shared.icon(forFile: appURL.path)
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

private func readPositiveDouble(_ raw: Any?) -> Double? {
    guard let value = readFiniteDouble(raw), value > 0 else { return nil }
    return value
}
