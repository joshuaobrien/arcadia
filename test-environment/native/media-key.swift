import AppKit
import Foundation

// Posts actual macOS NX_SYSDEFINED media-key events, not application command handlers.
let root = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
try Data().write(to: root.appendingPathComponent("armed"))
while !FileManager.default.fileExists(atPath: root.appendingPathComponent("done").path) {
  let request = root.appendingPathComponent("request")
  if let data = try? Data(contentsOf: request), let name = String(data: data, encoding: .utf8) {
    try FileManager.default.removeItem(at: request)
    guard name == "play-pause" || name == "next" else { exit(2) }
    let key = name == "play-pause" ? 16 : 17
    for state in [0xA, 0xB] {
      guard
        let event = NSEvent.otherEvent(
          with: .systemDefined, location: .zero,
          modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(state << 8)),
          timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: 0, context: nil,
          subtype: 8, data1: (key << 16) | (state << 8), data2: -1)?.cgEvent
      else { exit(3) }
      event.post(tap: .cghidEventTap)
    }
    try Data().write(to: root.appendingPathComponent("completed"))
  }
  RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
}
