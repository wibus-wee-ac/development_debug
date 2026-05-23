// Runs the cradle-mac-bridge NDJSON server and owns macOS native capabilities.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let bridgeVersion = "0.1.0"
let leftCommandKeyCode: CGKeyCode = 0x37
let rightCommandKeyCode: CGKeyCode = 0x36
let leftCommandDeviceFlag: UInt64 = 0x00000008
let rightCommandDeviceFlag: UInt64 = 0x00000010

final class BridgeError: Error, @unchecked Sendable {
    let code: String
    let message: String
    let details: [String: String]?

    init(_ code: String, _ message: String, details: [String: String]? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }
}

final class OutputWriter: @unchecked Sendable {
    private let lock = NSLock()

    func send(_ object: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }

        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let line = String(data: data, encoding: .utf8)
        else {
            fputs("{\"error\":{\"code\":\"serialization-failed\",\"message\":\"Failed to serialize bridge output\"}}\n", stdout)
            fflush(stdout)
            return
        }
        fputs("\(line)\n", stdout)
        fflush(stdout)
    }

    func respond(id: String, result: Any) {
        send(["id": id, "result": result])
    }

    func reject(id: String, error: BridgeError) {
        var payload: [String: Any] = [
            "code": error.code,
            "message": error.message,
        ]
        if let details = error.details {
            payload["details"] = details
        }
        send(["id": id, "error": payload])
    }

    func event(method: String, params: [String: Any]) {
        send(["method": method, "params": params])
    }
}

struct WindowCandidate {
    let windowId: Int
    let appName: String?
    let bundleId: String?
    let processId: Int
    let title: String?
    let bounds: [String: Double]?
}

final class InputMonitor: @unchecked Sendable {
    private let output: OutputWriter
    private let stateLock = NSLock()
    private var eventTap: CFMachPort?
    private var enabled = false
    private var tapEnableAttempted = false
    private var runLoopSourceCreated = false
    private var observedEventCount = 0
    private var lastEventAt: String?
    private var lastDisabledReason: String?
    private var lastSetupError: String?
    private var leftCommandDown = false
    private var rightCommandDown = false
    private var firedForCurrentPress = false
    private var debugEventsRemaining = 0
    private var debugSessionId = 0
    private var thread: Thread?

    init(output: OutputWriter) {
        self.output = output
    }

    func configure(enabled nextEnabled: Bool) throws {
        if nextEnabled {
            try start()
        } else {
            stop()
        }
    }

    func debugNextEvents(count: Int, timeoutSeconds: Double) throws {
        let sessionId: Int
        let initialObservedEventCount: Int
        stateLock.lock()
        debugEventsRemaining = max(0, count)
        debugSessionId += 1
        sessionId = debugSessionId
        initialObservedEventCount = observedEventCount
        stateLock.unlock()

        try configure(enabled: true)
        scheduleDebugTimeout(sessionId: sessionId, initialObservedEventCount: initialObservedEventCount, timeoutSeconds: timeoutSeconds)
    }

    func diagnostics() -> [String: Any] {
        stateLock.lock()
        let tap = eventTap
        let snapshot: [String: Any] = [
            "enabled": enabled,
            "tapCreated": tap != nil,
            "tapEnabled": tap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false,
            "tapEnableAttempted": tapEnableAttempted,
            "runLoopSourceCreated": runLoopSourceCreated,
            "observedEventCount": observedEventCount,
            "lastEventAt": lastEventAt ?? NSNull(),
            "lastDisabledReason": lastDisabledReason ?? NSNull(),
            "lastSetupError": lastSetupError ?? NSNull(),
            "leftCommandDown": leftCommandDown,
            "rightCommandDown": rightCommandDown,
            "permissions": permissionStatus(),
        ]
        stateLock.unlock()
        return snapshot
    }

    private func start() throws {
        if enabled {
            return
        }
        let eventMask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { _, type, event, refcon in
                guard let refcon else {
                    return Unmanaged.passUnretained(event)
                }
                let monitor = Unmanaged<InputMonitor>.fromOpaque(refcon).takeUnretainedValue()
                if type == .flagsChanged {
                    monitor.handle(event: event)
                } else if type == .tapDisabledByTimeout {
                    monitor.handleTapDisabled(reason: "timeout")
                } else if type == .tapDisabledByUserInput {
                    monitor.handleTapDisabled(reason: "userInput")
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            throw BridgeError("input-monitor-unavailable", "Mac Bridge could not create a Command-key event tap. Input Monitoring or Accessibility permission may be required.")
        }

        stateLock.lock()
        enabled = true
        eventTap = tap
        tapEnableAttempted = false
        runLoopSourceCreated = false
        lastSetupError = nil
        stateLock.unlock()

        thread = Thread { [weak self] in
            guard let self, let eventTap = self.eventTap else { return }
            guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
                self.recordSetupError("run-loop-source-unavailable")
                return
            }
            self.stateLock.lock()
            self.runLoopSourceCreated = true
            self.stateLock.unlock()
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
            CGEvent.tapEnable(tap: eventTap, enable: true)
            self.stateLock.lock()
            self.tapEnableAttempted = true
            self.stateLock.unlock()
            RunLoop.current.run()
        }
        thread?.name = "CradleMacBridgeInputMonitor"
        thread?.start()
    }

    private func stop() {
        stateLock.lock()
        enabled = false
        if let eventTap {
            CFMachPortInvalidate(eventTap)
        }
        eventTap = nil
        tapEnableAttempted = false
        runLoopSourceCreated = false
        leftCommandDown = false
        rightCommandDown = false
        firedForCurrentPress = false
        debugEventsRemaining = 0
        debugSessionId += 1
        stateLock.unlock()
    }

    private func handle(event: CGEvent) {
        let eventState = updateCommandState(event: event)
        emitDebugEvent(eventState)
        let hasBothCommand = (eventState["leftCommandDown"] as? Bool) == true
            && (eventState["rightCommandDown"] as? Bool) == true
        if !hasBothCommand {
            stateLock.lock()
            firedForCurrentPress = false
            stateLock.unlock()
            return
        }
        stateLock.lock()
        if firedForCurrentPress {
            stateLock.unlock()
            return
        }
        firedForCurrentPress = true
        stateLock.unlock()
        output.event(method: "event.mac.hotkeyTriggered", params: [
            "trigger": "bothCommand",
            "capturedAt": isoTimestamp(),
        ])
    }

    private func updateCommandState(event: CGEvent) -> [String: Any] {
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        let flagsRaw = event.flags.rawValue
        stateLock.lock()
        observedEventCount += 1
        lastEventAt = isoTimestamp()
        leftCommandDown = (flagsRaw & leftCommandDeviceFlag) != 0
        rightCommandDown = (flagsRaw & rightCommandDeviceFlag) != 0
        let snapshot: [String: Any] = [
            "keyCode": Int(keyCode),
            "flagsRaw": flagsRaw,
            "hasCommandFlag": event.flags.contains(.maskCommand),
            "leftCommandDown": leftCommandDown,
            "rightCommandDown": rightCommandDown,
            "observedEventCount": observedEventCount,
        ]
        stateLock.unlock()
        return snapshot
    }

    private func emitDebugEvent(_ eventState: [String: Any]) {
        stateLock.lock()
        guard debugEventsRemaining > 0 else {
            stateLock.unlock()
            return
        }
        debugEventsRemaining -= 1
        stateLock.unlock()
        output.event(method: "event.mac.inputDebug", params: eventState)
    }

    private func handleTapDisabled(reason: String) {
        stateLock.lock()
        lastDisabledReason = reason
        let tap = eventTap
        stateLock.unlock()

        output.event(method: "event.mac.inputMonitorDisabled", params: [
            "reason": reason,
            "capturedAt": isoTimestamp(),
        ])

        if let tap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }

    private func recordSetupError(_ message: String) {
        stateLock.lock()
        lastSetupError = message
        stateLock.unlock()
        output.event(method: "event.mac.inputMonitorSetupFailed", params: [
            "message": message,
            "capturedAt": isoTimestamp(),
        ])
    }

    private func scheduleDebugTimeout(sessionId: Int, initialObservedEventCount: Int, timeoutSeconds: Double) {
        let timeoutNanoseconds = UInt64(max(timeoutSeconds, 0.5) * 1_000_000_000)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .nanoseconds(Int(timeoutNanoseconds))) { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let shouldReport = self.debugSessionId == sessionId
                && self.debugEventsRemaining > 0
                && self.observedEventCount == initialObservedEventCount
            self.stateLock.unlock()
            if shouldReport {
                self.output.event(method: "event.mac.inputDebugTimeout", params: [
                    "timeoutSeconds": timeoutSeconds,
                    "diagnostics": self.diagnostics(),
                ])
            }
        }
    }
}

final class BridgeRuntime: @unchecked Sendable {
    private let output = OutputWriter()
    private let feedbackPresenter = FeedbackIndicatorPresenter()
    private lazy var inputMonitor = InputMonitor(output: output)

    @MainActor
    func run() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.finishLaunching()

        DispatchQueue.global(qos: .userInitiated).async {
            self.readInputLoop()
        }
        application.run()
    }

    private func readInputLoop() {
        defer {
            try? inputMonitor.configure(enabled: false)
            Task { @MainActor in
                NSApplication.shared.terminate(nil)
            }
        }

        while let line = readLine() {
            handle(line: line)
        }
    }

    private func handle(line: String) {
        guard let data = line.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = raw["id"] as? String,
              let method = raw["method"] as? String
        else {
            return
        }

        do {
            let params = raw["params"] as? [String: Any] ?? [:]
            let result = try handle(method: method, params: params)
            output.respond(id: id, result: result)
        } catch let error as BridgeError {
            output.reject(id: id, error: error)
        } catch {
            output.reject(id: id, error: BridgeError("unknown-error", "\(error)"))
        }
    }

    private func handle(method: String, params: [String: Any]) throws -> Any {
        switch method {
        case "bridge.status":
            return [
                "name": "cradle-mac-bridge",
                "version": bridgeVersion,
                "pid": Int(ProcessInfo.processInfo.processIdentifier),
                "platform": "darwin",
            ]
        case "mac.permissions.status":
            return permissionStatus()
        case "mac.permissions.request":
            return requestPermissions(params: params)
        case "mac.permissions.openSettings":
            return try openPermissionSettings(params: params)
        case "mac.input.configure":
            guard let trigger = params["trigger"] as? String, trigger == "bothCommand",
                  let enabled = params["enabled"] as? Bool
            else {
                throw BridgeError("invalid-params", "mac.input.configure requires trigger=bothCommand and enabled boolean.")
            }
            try inputMonitor.configure(enabled: enabled)
            return [
                "trigger": "bothCommand",
                "enabled": enabled,
                "diagnostics": inputMonitor.diagnostics(),
            ]
        case "mac.input.diagnostics":
            return inputMonitor.diagnostics()
        case "mac.input.debugNext":
            let count = params["count"] as? Int ?? 8
            let timeoutSeconds = (params["timeoutSeconds"] as? NSNumber)?.doubleValue ?? 3
            try inputMonitor.debugNextEvents(count: count, timeoutSeconds: timeoutSeconds)
            return [
                "count": count,
                "timeoutSeconds": timeoutSeconds,
                "diagnostics": inputMonitor.diagnostics(),
            ]
        case "mac.capture.frontmostWindow":
            return try captureFrontmostWindow(params: params, feedbackPresenter: feedbackPresenter)
        default:
            throw BridgeError("unknown-method", "Unknown Mac Bridge method: \(method)")
        }
    }
}

func permissionStatus() -> [String: Any] {
    [
        "accessibility": AXIsProcessTrusted() ? "granted" : "denied",
        "screenRecording": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
        "inputMonitoring": CGPreflightListenEventAccess() ? "granted" : "denied",
    ]
}

func requestPermissions(params: [String: Any]) -> [String: Any] {
    let permissions = readRequestedPermissions(params: params)
    var requested: [String] = []

    for permission in permissions {
        switch permission {
        case "accessibility":
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            requested.append(permission)
        case "screenRecording":
            _ = CGRequestScreenCaptureAccess()
            requested.append(permission)
        case "inputMonitoring":
            _ = CGRequestListenEventAccess()
            requested.append(permission)
        default:
            continue
        }
    }

    return [
        "requested": requested,
        "status": permissionStatus(),
    ]
}

func readRequestedPermissions(params: [String: Any]) -> [String] {
    let defaultPermissions = ["accessibility", "inputMonitoring", "screenRecording"]
    guard let rawPermissions = params["permissions"] as? [String], !rawPermissions.isEmpty else {
        return defaultPermissions
    }
    return rawPermissions
}

func openPermissionSettings(params: [String: Any]) throws -> [String: Any] {
    let target = try readPermissionSettingsTarget(params: params)
    let urlString = permissionSettingsURLString(target: target)
    guard let url = URL(string: urlString) else {
        throw BridgeError("invalid-settings-url", "Mac Bridge could not build a System Settings URL.", details: [
            "target": target,
            "url": urlString,
        ])
    }

    let opened = NSWorkspace.shared.open(url)
    if !opened {
        throw BridgeError("settings-open-failed", "Mac Bridge could not open macOS System Settings.", details: [
            "target": target,
            "url": urlString,
        ])
    }

    return [
        "target": target,
        "url": urlString,
        "opened": opened,
    ]
}

func readPermissionSettingsTarget(params: [String: Any]) throws -> String {
    let target = params["target"] as? String ?? "privacy"
    let allowedTargets = ["privacy", "accessibility", "inputMonitoring", "screenRecording"]
    guard allowedTargets.contains(target) else {
        throw BridgeError("invalid-params", "mac.permissions.openSettings received an unsupported target.", details: [
            "target": target,
        ])
    }
    return target
}

func permissionSettingsURLString(target: String) -> String {
    switch target {
    case "accessibility":
        return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    case "inputMonitoring":
        return "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
    case "screenRecording":
        return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    default:
        return "x-apple.systempreferences:com.apple.preference.security?Privacy"
    }
}

func captureFrontmostWindow(params: [String: Any], feedbackPresenter: FeedbackIndicatorPresenter) throws -> [String: Any] {
    guard let outputDir = params["outputDir"] as? String, !outputDir.isEmpty else {
        throw BridgeError("invalid-params", "mac.capture.frontmostWindow requires outputDir.")
    }

    do {
        let window = try readFrontmostWindow()
        try enforcePrivacyRules(window: window, params: params)

        let fileManager = FileManager.default
        try fileManager.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let captureId = "capture-\(Int(Date().timeIntervalSince1970 * 1000))-\(window.windowId)"
        let filePath = (outputDir as NSString).appendingPathComponent("\(captureId).png")
        let metadataPath = (outputDir as NSString).appendingPathComponent("\(captureId).json")
        try runScreenCapture(windowId: window.windowId, filePath: filePath)

        let capturedAt = isoTimestamp()
        let metadata: [String: Any] = [
            "filePath": filePath,
            "metadataPath": metadataPath,
            "capturedAt": capturedAt,
            "window": serialize(window: window),
        ]
        let metadataData = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
        try metadataData.write(to: URL(fileURLWithPath: metadataPath), options: [.atomic])

        feedbackPresenter.show(.success(
            label: "Screenshot captured",
            detail: (filePath as NSString).lastPathComponent,
            icon: .camera,
            targetWindowBounds: window.bounds,
            revealFilePath: filePath
        ))

        return metadata
    } catch let error as BridgeError {
        feedbackPresenter.show(.failure(label: "Screenshot failed", detail: error.message, icon: .camera))
        throw error
    } catch {
        feedbackPresenter.show(.failure(label: "Screenshot failed", detail: "\(error)", icon: .camera))
        throw error
    }
}

func readFrontmostWindow() throws -> WindowCandidate {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        throw BridgeError("frontmost-app-unavailable", "No frontmost application is available.")
    }
    let pid = Int(app.processIdentifier)
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let rawWindows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        throw BridgeError("window-inventory-unavailable", "CoreGraphics did not return a window inventory.")
    }

    let candidates = rawWindows.compactMap { raw -> WindowCandidate? in
        guard let ownerPid = raw[kCGWindowOwnerPID as String] as? Int, ownerPid == pid,
              let layer = raw[kCGWindowLayer as String] as? Int, layer == 0,
              let windowId = raw[kCGWindowNumber as String] as? Int
        else {
            return nil
        }
        let bounds = readBounds(raw[kCGWindowBounds as String])
        if let bounds, (bounds["width"] ?? 0) <= 1 || (bounds["height"] ?? 0) <= 1 {
            return nil
        }
        return WindowCandidate(
            windowId: windowId,
            appName: app.localizedName ?? raw[kCGWindowOwnerName as String] as? String,
            bundleId: app.bundleIdentifier,
            processId: pid,
            title: raw[kCGWindowName as String] as? String,
            bounds: bounds
        )
    }

    guard let selected = candidates.first else {
        throw BridgeError("frontmost-window-unavailable", "No capturable frontmost window was found.")
    }
    return selected
}

func readBounds(_ raw: Any?) -> [String: Double]? {
    guard let raw = raw as? [String: Any] else {
        return nil
    }
    return [
        "x": (raw["X"] as? NSNumber)?.doubleValue ?? 0,
        "y": (raw["Y"] as? NSNumber)?.doubleValue ?? 0,
        "width": (raw["Width"] as? NSNumber)?.doubleValue ?? 0,
        "height": (raw["Height"] as? NSNumber)?.doubleValue ?? 0,
    ]
}

func enforcePrivacyRules(window: WindowCandidate, params: [String: Any]) throws {
    let bundleIds = params["privacySensitiveAppBundleIds"] as? [String] ?? []
    if let bundleId = window.bundleId, bundleIds.contains(bundleId) {
        throw BridgeError("privacy-sensitive-window", "Capture blocked by privacy-sensitive app rule.", details: [
            "bundleId": bundleId,
        ])
    }

    let titlePatterns = params["privacySensitiveTitlePatterns"] as? [String] ?? []
    if let title = window.title {
        for pattern in titlePatterns where !pattern.isEmpty {
            if title.range(of: pattern, options: [.caseInsensitive, .diacriticInsensitive]) != nil {
                throw BridgeError("privacy-sensitive-window", "Capture blocked by privacy-sensitive title rule.", details: [
                    "pattern": pattern,
                ])
            }
        }
    }
}

func runScreenCapture(windowId: Int, filePath: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-x", "-l", String(windowId), filePath]
    let stderr = Pipe()
    process.standardError = stderr

    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
        let data = stderr.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        throw BridgeError("screen-capture-failed", message?.isEmpty == false ? message! : "screencapture failed.")
    }
    if !FileManager.default.fileExists(atPath: filePath) {
        throw BridgeError("screen-capture-missing-output", "screencapture finished without writing the output file.")
    }
}

func serialize(window: WindowCandidate) -> [String: Any] {
    [
        "windowId": window.windowId,
        "appName": window.appName ?? NSNull(),
        "bundleId": window.bundleId ?? NSNull(),
        "processId": window.processId,
        "title": window.title ?? NSNull(),
        "bounds": window.bounds ?? NSNull(),
    ]
}

func isoTimestamp() -> String {
    ISO8601DateFormatter().string(from: Date())
}

let runtime = BridgeRuntime()
runtime.run()
