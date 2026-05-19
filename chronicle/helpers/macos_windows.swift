// Input: current macOS window server state
// Output: one tab-separated line per visible window: id, bundle identifier, title
// Position: privacy preflight helper for Cradle Chronicle macOS capture

import AppKit
import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windowInfo = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
let workspaceApps = NSWorkspace.shared.runningApplications
let bundleByPid = Dictionary(uniqueKeysWithValues: workspaceApps.compactMap { app -> (pid_t, String)? in
  guard let bundleIdentifier = app.bundleIdentifier else {
    return nil
  }
  return (app.processIdentifier, bundleIdentifier)
})

for window in windowInfo {
  guard
    let id = window[kCGWindowNumber as String] as? UInt32,
    let pid = window[kCGWindowOwnerPID as String] as? pid_t
  else {
    continue
  }
  let title = (window[kCGWindowName as String] as? String) ?? ""
  let owner = (window[kCGWindowOwnerName as String] as? String) ?? "unknown"
  let bundleIdentifier = bundleByPid[pid] ?? owner
  let cleanTitle = title.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ")
  print("\(id)\t\(bundleIdentifier)\t\(cleanTitle)")
}
