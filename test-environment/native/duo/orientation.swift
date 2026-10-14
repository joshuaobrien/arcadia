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
  if attribute(element, kAXRoleAttribute) as? String == role
    && attribute(element, kAXTitleAttribute) as? String == title
  {
    result.append(element)
  }
  for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
    result += descendants(child, role: role, title: title, depth: depth + 1)
  }
  return result
}
func reject(_ message: String) -> Never {
  fputs(message + "\n", stderr)
  exit(2)
}
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
guard booted.count == 1, booted[0]["udid"] as? String == expected else {
  reject("Owned device is not the only booted simulator")
}
guard AXIsProcessTrusted() else { reject("Guest native control helper lacks Accessibility permission") }
guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.apple.dt.Devices" })
else { reject("Device Hub is not running inside the guest") }
let element = AXUIElementCreateApplication(app.processIdentifier)
let windows = attribute(element, kAXWindowsAttribute) as? [AXUIElement] ?? []
let titles = windows.compactMap { attribute($0, kAXTitleAttribute) as? String }
guard titles.contains(where: { $0.replacingOccurrences(of: " ", with: "").contains(deviceName) })
else { reject("Device Hub has no window for the owned phone: " + titles.joined(separator: ", ")) }
let controls = descendants(element, role: kAXMenuBarItemRole, title: "Device")
guard controls.count == 1 else { reject("Cannot uniquely identify Device Hub Controls menu") }
let orientation = descendants(controls[0], role: kAXMenuItemRole, title: "Orientation")
guard orientation.count == 1 else { reject("No native Device > Orientation") }
let lock = descendants(orientation[0], role: kAXMenuItemRole, title: "Landscape Right")
guard lock.count == 1, attribute(lock[0], kAXEnabledAttribute) as? Bool == true
else { reject("Cannot uniquely identify enabled Device > Orientation > Landscape Right") }
if CommandLine.arguments.count == 4 && CommandLine.arguments[3] == "inspect" {
  print(
    "Verified owned device " + expected + "; Device Hub windows: " + titles.joined(separator: ", ")
      + "; native Device > Orientation > Landscape Right available")
  exit(0)
}
app.activate(options: [.activateIgnoringOtherApps])
let status = AXUIElementPerformAction(lock[0], kAXPressAction as CFString)
let record: [String: Any] = [
  "device_udid": expected, "device_hub_pid": app.processIdentifier,
  "window_titles": titles, "menu_path": ["Device", "Orientation", "Landscape Right"], "ax_status": status.rawValue,
  "timestamp": Date().timeIntervalSince1970,
]
FileHandle.standardOutput.write(
  try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]))
exit(status == .success ? 0 : 3)
