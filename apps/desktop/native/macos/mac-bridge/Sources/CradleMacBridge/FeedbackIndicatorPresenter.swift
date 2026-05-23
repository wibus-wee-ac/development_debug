// Presents reusable AppKit feedback indicators for native Mac Bridge actions.
import AppKit
import QuartzCore

enum FeedbackIndicatorTone {
    case success
    case failure
}

enum FeedbackIndicatorIcon {
    case camera
    case check
    case xmark
}

struct FeedbackIndicatorContent {
    let tone: FeedbackIndicatorTone
    let icon: FeedbackIndicatorIcon
    let label: String
    let detail: String?
    let duration: TimeInterval
    let targetWindowBounds: [String: Double]?
    let revealFilePath: String?

    static func success(
        label: String,
        detail: String? = nil,
        icon: FeedbackIndicatorIcon = .check,
        targetWindowBounds: [String: Double]? = nil,
        revealFilePath: String? = nil
    ) -> FeedbackIndicatorContent {
        FeedbackIndicatorContent(
            tone: .success,
            icon: icon,
            label: label,
            detail: detail,
            duration: 3.4,
            targetWindowBounds: targetWindowBounds,
            revealFilePath: revealFilePath
        )
    }

    static func failure(
        label: String,
        detail: String? = nil,
        icon: FeedbackIndicatorIcon = .xmark,
        targetWindowBounds: [String: Double]? = nil
    ) -> FeedbackIndicatorContent {
        FeedbackIndicatorContent(
            tone: .failure,
            icon: icon,
            label: label,
            detail: detail,
            duration: 2.8,
            targetWindowBounds: targetWindowBounds,
            revealFilePath: nil
        )
    }
}

final class FeedbackIndicatorPresenter: @unchecked Sendable {
    private var panel: NSPanel?
    private var dismissWorkItem: DispatchWorkItem?

    func show(_ content: FeedbackIndicatorContent) {
        Task { @MainActor [weak self] in
            self?.showOnMain(content)
        }
    }

    @MainActor
    private func showOnMain(_ content: FeedbackIndicatorContent) {
        let application = NSApplication.shared
        if application.activationPolicy() == .regular {
            application.setActivationPolicy(.accessory)
        }

        dismissWorkItem?.cancel()

        let view = FeedbackIndicatorContainerView(content: content)
        view.translatesAutoresizingMaskIntoConstraints = false
        let fittingSize = view.intrinsicContentSize
        let panelSize = NSSize(
            width: min(max(fittingSize.width, 220), 390),
            height: content.detail == nil ? 48 : 64
        )
        let panel = self.panel ?? createPanel()
        self.panel = panel
        panel.contentView = view
        panel.setFrame(readFrame(size: panelSize, targetWindowBounds: content.targetWindowBounds), display: true)
        panel.alphaValue = 0
        panel.orderFrontRegardless()

        animateIn(panel: panel)

        let workItem = DispatchWorkItem { [weak self, weak panel] in
            guard let panel else { return }
            self?.animateOut(panel: panel)
        }
        dismissWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + content.duration, execute: workItem)
    }

    @MainActor
    private func createPanel() -> NSPanel {
        let panel = FeedbackIndicatorPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.level = .statusBar
        panel.ignoresMouseEvents = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        return panel
    }

    @MainActor
    private func readFrame(size: NSSize, targetWindowBounds: [String: Double]?) -> NSRect {
        let screen = readTargetScreen(targetWindowBounds: targetWindowBounds)
        let visibleFrame = screen.visibleFrame
        let origin = NSPoint(
            x: visibleFrame.midX - size.width / 2,
            y: visibleFrame.maxY - size.height - 22
        )
        return NSRect(origin: origin, size: size)
    }

    @MainActor
    private func readTargetScreen(targetWindowBounds: [String: Double]?) -> NSScreen {
        if let targetWindowBounds, let screen = readScreen(containing: targetWindowBounds) {
            return screen
        }
        let mouseLocation = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { $0.frame.contains(mouseLocation) }) ?? NSScreen.main ?? NSScreen.screens[0]
    }

    @MainActor
    private func readScreen(containing bounds: [String: Double]) -> NSScreen? {
        guard let x = bounds["x"],
              let y = bounds["y"],
              let width = bounds["width"],
              let height = bounds["height"]
        else {
            return nil
        }

        let center = NSPoint(x: x + width / 2, y: y + height / 2)
        return NSScreen.screens.first { $0.frame.contains(center) }
    }

    @MainActor
    private func animateIn(panel: NSPanel) {
        panel.contentView?.wantsLayer = true
        panel.contentView?.layer?.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        panel.contentView?.layer?.transform = CATransform3DMakeScale(0.92, 0.92, 1)
        panel.contentView?.layer?.opacity = 0

        let spring = CASpringAnimation(keyPath: "transform.scale")
        spring.fromValue = 0.92
        spring.toValue = 1
        spring.mass = 0.7
        spring.stiffness = 360
        spring.damping = 26
        spring.initialVelocity = 0
        spring.duration = spring.settlingDuration

        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = 0
        opacity.toValue = 1
        opacity.duration = 0.16
        opacity.timingFunction = CAMediaTimingFunction(name: .easeOut)

        panel.alphaValue = 1
        panel.contentView?.layer?.transform = CATransform3DIdentity
        panel.contentView?.layer?.opacity = 1
        panel.contentView?.layer?.add(spring, forKey: "feedback-scale-in")
        panel.contentView?.layer?.add(opacity, forKey: "feedback-opacity-in")
    }

    @MainActor
    private func animateOut(panel: NSPanel) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().alphaValue = 0
        } completionHandler: { [weak self, weak panel] in
            panel?.orderOut(nil)
            if self?.panel === panel {
                self?.panel = nil
            }
        }
    }
}

final class FeedbackIndicatorPanel: NSPanel {
    override var canBecomeKey: Bool {
        false
    }

    override var canBecomeMain: Bool {
        false
    }
}

final class FeedbackIndicatorContainerView: NSView {
    private let indicatorView: FeedbackIndicatorView

    init(content: FeedbackIndicatorContent) {
        indicatorView = FeedbackIndicatorView(content: content)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.masksToBounds = false

        indicatorView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(indicatorView)
        NSLayoutConstraint.activate([
            indicatorView.leadingAnchor.constraint(equalTo: leadingAnchor),
            indicatorView.trailingAnchor.constraint(equalTo: trailingAnchor),
            indicatorView.topAnchor.constraint(equalTo: topAnchor),
            indicatorView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var intrinsicContentSize: NSSize {
        indicatorView.intrinsicContentSize
    }

    override func layout() {
        super.layout()
    }
}

final class FeedbackIndicatorView: NSView {
    private let content: FeedbackIndicatorContent

    init(content: FeedbackIndicatorContent) {
        self.content = content
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = content.detail == nil ? 24 : 32
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.78).cgColor
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.35).cgColor
        setupContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var intrinsicContentSize: NSSize {
        NSSize(width: content.revealFilePath == nil ? 320 : 356, height: content.detail == nil ? 48 : 64)
    }

    private func setupContent() {
        let iconView = FeedbackIconView(tone: content.tone, icon: content.icon)
        iconView.translatesAutoresizingMaskIntoConstraints = false

        let textStack = NSStackView()
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 1
        textStack.translatesAutoresizingMaskIntoConstraints = false

        let label = NSTextField(labelWithString: content.label)
        label.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        label.textColor = .labelColor
        label.lineBreakMode = .byTruncatingTail
        textStack.addArrangedSubview(label)

        if let detail = content.detail, !detail.isEmpty {
            let detailLabel = NSTextField(labelWithString: detail)
            detailLabel.font = NSFont.systemFont(ofSize: 11, weight: .regular)
            detailLabel.textColor = .secondaryLabelColor
            detailLabel.lineBreakMode = .byTruncatingMiddle
            textStack.addArrangedSubview(detailLabel)
        }

        var arrangedSubviews: [NSView] = [iconView, textStack]
        if content.revealFilePath != nil {
            arrangedSubviews.append(createRevealButton())
        }

        let stack = NSStackView(views: arrangedSubviews)
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: 28),
            iconView.heightAnchor.constraint(equalToConstant: 28),
            textStack.widthAnchor.constraint(greaterThanOrEqualToConstant: 170),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    private func createRevealButton() -> NSButton {
        let image = NSImage(systemSymbolName: "folder", accessibilityDescription: "Reveal in Finder")
            ?? NSImage(size: NSSize(width: 16, height: 16))
        let button = NSButton(image: image, target: self, action: #selector(revealInFinder))
        button.translatesAutoresizingMaskIntoConstraints = false
        button.isBordered = false
        button.bezelStyle = .regularSquare
        button.imagePosition = .imageOnly
        button.toolTip = "Reveal in Finder"
        button.wantsLayer = true
        button.layer?.cornerRadius = 14
        button.layer?.cornerCurve = .continuous
        button.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.14).cgColor
        button.contentTintColor = .labelColor
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 28),
            button.heightAnchor.constraint(equalToConstant: 28),
        ])
        return button
    }

    @objc private func revealInFinder() {
        guard let revealFilePath = content.revealFilePath else {
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([
            URL(fileURLWithPath: revealFilePath),
        ])
    }
}

final class FeedbackIconView: NSView {
    private let tone: FeedbackIndicatorTone
    private let icon: FeedbackIndicatorIcon

    init(tone: FeedbackIndicatorTone, icon: FeedbackIndicatorIcon) {
        self.tone = tone
        self.icon = icon
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        layer?.backgroundColor = backgroundColor.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    private var backgroundColor: NSColor {
        switch tone {
        case .success:
            return NSColor.systemGreen.withAlphaComponent(0.16)
        case .failure:
            return NSColor.systemRed.withAlphaComponent(0.16)
        }
    }

    private var strokeColor: NSColor {
        switch tone {
        case .success:
            return .systemGreen
        case .failure:
            return .systemRed
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        strokeColor.setStroke()
        let path = NSBezierPath()
        path.lineWidth = 2
        path.lineCapStyle = .round
        path.lineJoinStyle = .round

        switch icon {
        case .camera:
            drawCameraIcon(path: path)
        case .check:
            path.move(to: NSPoint(x: 8, y: 14))
            path.line(to: NSPoint(x: 12, y: 10))
            path.line(to: NSPoint(x: 20, y: 18))
        case .xmark:
            path.move(to: NSPoint(x: 9, y: 9))
            path.line(to: NSPoint(x: 19, y: 19))
            path.move(to: NSPoint(x: 19, y: 9))
            path.line(to: NSPoint(x: 9, y: 19))
        }
        path.stroke()
    }

    private func drawCameraIcon(path: NSBezierPath) {
        let body = NSBezierPath(roundedRect: NSRect(x: 7, y: 9, width: 14, height: 11), xRadius: 3, yRadius: 3)
        body.lineWidth = 2
        body.stroke()

        let lens = NSBezierPath(ovalIn: NSRect(x: 11, y: 12, width: 6, height: 6))
        lens.lineWidth = 2
        lens.stroke()

        path.move(to: NSPoint(x: 10, y: 20))
        path.line(to: NSPoint(x: 12, y: 22))
        path.line(to: NSPoint(x: 16, y: 22))
        path.line(to: NSPoint(x: 18, y: 20))
    }
}
