import AppKit
import ApplicationServices

func value(_ e: AXUIElement, _ key: String) -> Any? {
  var v: CFTypeRef?
  AXUIElementCopyAttributeValue(e, key as CFString, &v)
  return v
}
func walk(_ e: AXUIElement, _ depth: Int = 0) {
  guard depth < 12 else { return }
  let keys = [
    "AXRole", "AXTitle", "AXDescription", "AXIdentifier", "AXValue", "AXPosition", "AXSize", "AXMinValue", "AXMaxValue",
  ]
  print(
    String(repeating: " ", count: depth)
      + keys.compactMap { key in value(e, key).map { "\(key)=\($0)" } }.joined(separator: " | "))
  if let children = value(e, "AXChildren") as? [AXUIElement] { for c in children { walk(c, depth + 1) } }
}
func find(_ e: AXUIElement, _ text: String, _ matches: inout [AXUIElement], _ depth: Int = 0) {
  guard depth < 16 else { return }
  if ["AXButton", "AXSlider"].contains(value(e, "AXRole") as? String ?? "")
    && ["AXTitle", "AXDescription", "AXIdentifier"].contains(where: { (value(e, $0) as? String) == text })
  {
    matches.append(e)
  }
  if let children = value(e, "AXChildren") as? [AXUIElement] {
    for c in children { find(c, text, &matches, depth + 1) }
  }
}
let a = CommandLine.arguments
if a.count == 2 && a[1] == "hinge-bounds" {
  guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.apple.dt.Devices" })
  else { exit(2) }
  var matches = [AXUIElement]()
  find(AXUIElementCreateApplication(app.processIdentifier), "deviceChrome.poseHingeSlider", &matches)
  guard matches.count == 1, let element = matches.first else {
    print("Expected one owned visible hinge slider, found \(matches.count)")
    exit(3)
  }
  guard let position = value(element, "AXPosition"), let size = value(element, "AXSize") else { exit(4) }
  var point = CGPoint.zero
  var dimensions = CGSize.zero
  guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
  else { exit(4) }
  let record: [String: Any] = [
    "x": point.x, "y": point.y, "width": dimensions.width, "height": dimensions.height,
    "value": String(describing: value(element, "AXValue") ?? ""), "pid": app.processIdentifier,
  ]
  let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
  print(String(decoding: data, as: UTF8.self))
  exit(0)
}
if a.count > 5 && a[1] == "drag" {
  let start = CGPoint(x: Double(a[2])!, y: Double(a[3])!)
  let end = CGPoint(x: Double(a[4])!, y: Double(a[5])!)
  func post(_ type: CGEventType, _ p: CGPoint) {
    let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
    e.flags = .maskAlternate
    e.post(tap: .cghidEventTap)
  }
  post(.mouseMoved, start)
  Thread.sleep(forTimeInterval: 0.15)
  post(.leftMouseDown, start)
  Thread.sleep(forTimeInterval: 0.15)
  for i in 1...30 {
    let f = Double(i) / 30
    post(.leftMouseDragged, CGPoint(x: start.x + (end.x - start.x) * f, y: start.y + (end.y - start.y) * f))
    Thread.sleep(forTimeInterval: 0.03)
  }
  post(.leftMouseUp, end)
  exit(0)
}
if a.count > 2 && a[1] == "press" {
  guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.apple.dt.Devices" })
  else { exit(2) }
  var matches = [AXUIElement]()
  find(AXUIElementCreateApplication(app.processIdentifier), a[2], &matches)
  guard !matches.isEmpty else {
    print("No control: \(a[2])")
    exit(3)
  }
  let e = a.count > 3 && a[3] == "last" ? matches.last! : matches.first!
  let result = AXUIElementPerformAction(e, kAXPressAction as CFString)
  print("press \(a[2]): \(result.rawValue)")
  exit(result == .success ? 0 : 4)
}
if a.count > 1 && a[1] == "option" {
  let down = a.count > 2 && a[2] == "down"
  let e = CGEvent(keyboardEventSource: nil, virtualKey: 58, keyDown: down)!
  e.type = .flagsChanged
  e.flags = down ? .maskAlternate : []
  e.post(tap: .cghidEventTap)
  exit(0)
}
if a.count > 1 && a[1] == "click" {
  let p = CGPoint(x: Double(a[2])!, y: Double(a[3])!)
  for type in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(
      tap: .cghidEventTap)
  }
  exit(0)
}
if a.count > 1 {
  print("Unknown command")
  exit(64)
}
print("trusted=\(AXIsProcessTrusted())")
for app in NSWorkspace.shared.runningApplications where app.bundleIdentifier == "com.apple.dt.Devices" {
  walk(AXUIElementCreateApplication(app.processIdentifier))
}
