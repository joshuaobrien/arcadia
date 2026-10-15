import AppKit
import ApplicationServices
import Foundation

func attribute(_ element: AXUIElement, _ key: String) -> Any? {
  var value: CFTypeRef?
  AXUIElementCopyAttributeValue(element, key as CFString, &value)
  return value
}
func descendants(_ element: AXUIElement, role: String, title: String, depth: Int = 0) -> [AXUIElement] {
  guard depth < 18 else { return [] }
  var result: [AXUIElement] = []
  if attribute(element, kAXRoleAttribute) as? String == role && attribute(element, kAXTitleAttribute) as? String == title {
    result.append(element)
  }
  for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
    result += descendants(child, role: role, title: title, depth: depth + 1)
  }
  return result
}
func reject(_ message: String) -> Never { fputs(message + "\n", stderr); exit(2) }
guard (3...4).contains(CommandLine.arguments.count) else { reject("Expected owned simulator UDID and device name") }
let expected = CommandLine.arguments[1]
let deviceName = CommandLine.arguments[2].replacingOccurrences(of: " ", with: "")
let inventory = Process()
inventory.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
inventory.arguments = ["simctl", "list", "devices", "booted", "--json"]
let pipe = Pipe()
inventory.standardOutput = pipe
try inventory.run()
let data = pipe.fileHandleForReading.readDataToEndOfFile()
inventory.waitUntilExit()
guard inventory.terminationStatus == 0,
  let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
  let groups = root["devices"] as? [String: [[String: Any]]]
else { reject("Cannot verify owned simulator inventory") }
let booted = groups.values.flatMap { $0 }.filter { $0["state"] as? String == "Booted" }
guard booted.count == 1, booted[0]["udid"] as? String == expected else { reject("Owned device is not the only booted simulator") }
guard AXIsProcessTrusted() else { reject("Guest native control helper lacks Accessibility permission") }
guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.apple.dt.Devices" })
else { reject("Device Hub is not running inside the guest") }
let element = AXUIElementCreateApplication(app.processIdentifier)
let windows = attribute(element, kAXWindowsAttribute) as? [AXUIElement] ?? []
let titles = windows.compactMap { attribute($0, kAXTitleAttribute) as? String }
guard titles.contains(where: { $0.replacingOccurrences(of: " ", with: "").contains(deviceName) })
else { reject("Device Hub has no window for the owned phone: " + titles.joined(separator: ", ")) }
func deviceIDs(_ root: AXUIElement, depth: Int = 0) -> Set<String> {
  guard depth < 8 else { return [] }
  var ids = Set<String>()
  if let id = attribute(root, kAXIdentifierAttribute) as? String, id.hasPrefix("TableRow.Device.") {
    ids.insert(String(id.dropFirst("TableRow.Device.".count)))
  }
  for child in attribute(root, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
    ids.formUnion(deviceIDs(child, depth: depth + 1))
  }
  return ids
}
func selectedIDs(_ root: AXUIElement, depth: Int = 0) -> Set<String> {
  guard depth < 20 else { return [] }
  if attribute(root, kAXRoleAttribute) as? String == kAXRowRole,
    attribute(root, kAXSelectedAttribute) as? Bool == true {
    return deviceIDs(root)
  }
  return (attribute(root, kAXChildrenAttribute) as? [AXUIElement] ?? []).reduce(into: Set<String>()) {
    $0.formUnion(selectedIDs($1, depth: depth + 1))
  }
}
guard selectedIDs(element) == Set([expected]) else { reject("Device Hub selected row is not the owned simulator") }
guard let focused = attribute(element, kAXFocusedWindowAttribute) else { reject("No focused Device Hub window") }
let focusedTitle = attribute(focused as! AXUIElement, kAXTitleAttribute) as? String ?? ""
guard focusedTitle.replacingOccurrences(of: " ", with: "").contains(deviceName)
else { reject("Focused Device Hub window is not the owned device") }
let controls = descendants(element, role: kAXMenuBarItemRole, title: "Controls")
guard controls.count == 1 else { reject("Cannot uniquely identify Device Hub Controls menu") }
let lock = descendants(controls[0], role: kAXMenuItemRole, title: "Lock")
guard lock.count == 1, attribute(lock[0], kAXEnabledAttribute) as? Bool == true
else { reject("Cannot uniquely identify enabled Controls > Lock") }
if CommandLine.arguments.count == 4 && CommandLine.arguments[3] == "inspect" {
  print("Verified owned device " + expected + "; selected row " + expected + "; focused Device Hub: " + focusedTitle + "; Device Hub windows: " + titles.joined(separator: ", ") + "; native Controls > Lock available")
  exit(0)
}
app.activate(options: [])
let activationDeadline = Date().addingTimeInterval(3)
while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier,
  Date() < activationDeadline {
  RunLoop.current.run(until: Date().addingTimeInterval(0.05))
}
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
else { reject("Device Hub did not become the frontmost native application") }
guard AXUIElementPerformAction(controls[0], kAXPressAction as CFString) == .success
else { reject("Could not open the observed Controls menu") }
func visibleBounds(_ item: AXUIElement) -> CGRect? {
  guard let rawPosition = attribute(item, kAXPositionAttribute), let rawSize = attribute(item, kAXSizeAttribute)
  else { return nil }
  var position = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &position),
    AXValueGetValue(rawSize as! AXValue, .cgSize, &size), size.width > 0, size.height > 0
  else { return nil }
  return CGRect(origin: position, size: size)
}
let menuDeadline = Date().addingTimeInterval(3)
while visibleBounds(lock[0]) == nil, Date() < menuDeadline {
  RunLoop.current.run(until: Date().addingTimeInterval(0.05))
}
guard let lockBounds = visibleBounds(lock[0]) else { reject("Observed Lock menu item never became visible") }
let status = AXUIElementPerformAction(lock[0], kAXPressAction as CFString)
let record: [String: Any] = ["device_udid": expected, "device_hub_pid": app.processIdentifier,
  "window_titles": titles, "menu_path": ["Controls", "Lock"], "ax_status": status.rawValue,
  "timestamp": Date().timeIntervalSince1970, "frontmost_pid": app.processIdentifier,
  "lock_menu_bounds": [lockBounds.minX, lockBounds.minY, lockBounds.width, lockBounds.height]]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]))
exit(status == .success ? 0 : 3)
