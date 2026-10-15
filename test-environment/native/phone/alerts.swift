import AppKit
import ApplicationServices
func value(_ e: AXUIElement, _ key: CFString) -> Any? {var v: CFTypeRef?; guard AXUIElementCopyAttributeValue(e,key,&v) == .success else{return nil};return v}
func buttons(_ e: AXUIElement, _ depth: Int = 0) -> [String] {
 guard depth < 10 else { return [] }
 var result: [String] = []
 if value(e,kAXRoleAttribute as CFString) as? String == kAXButtonRole { result.append((value(e,kAXTitleAttribute as CFString) as? String) ?? (value(e,kAXDescriptionAttribute as CFString) as? String) ?? "untitled") }
 for child in value(e,kAXChildrenAttribute as CFString) as? [AXUIElement] ?? [] {result += buttons(child,depth+1)}
 return result
}
print("trusted=\(AXIsProcessTrusted())")
for app in NSWorkspace.shared.runningApplications {
 let root = AXUIElementCreateApplication(app.processIdentifier)
 var raw: CFTypeRef?
 let status = AXUIElementCopyAttributeValue(root,kAXWindowsAttribute as CFString,&raw)
 let windows = raw as? [AXUIElement] ?? []
 if !windows.isEmpty || (app.bundleIdentifier ?? "").contains("Notification") || (app.bundleIdentifier ?? "").contains("Security") {
  let record: [String: Any] = ["application": app.localizedName ?? "", "bundle": app.bundleIdentifier ?? "", "pid": app.processIdentifier, "axStatus": status.rawValue, "windows": windows.map { ["title":value($0,kAXTitleAttribute as CFString) as? String ?? "", "role":value($0,kAXRoleAttribute as CFString) as? String ?? "", "buttons":buttons($0)] }]
  print(String(decoding:try JSONSerialization.data(withJSONObject:record,options:[.sortedKeys]),as:UTF8.self))
 }
}
