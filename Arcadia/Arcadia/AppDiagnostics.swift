import Foundation
import OSLog

// Log only controlled state names. Request URLs, payloads and credentials stay out of diagnostics.
enum AppDiagnostics {
  private static let logger = Logger(subsystem: "tokyo.drift.Arcadia", category: "native-loop")
  private static let runID = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "untracked"

  static func configuration(_ configuration: AppConfiguration) {
    let mode = configuration.dataMode.rawValue
    let scenario = configuration.fixtureScenario.rawValue
    logger.notice(
      "run=\(runID, privacy: .public) mode=\(mode, privacy: .public) scenario=\(scenario, privacy: .public)")
  }

  static func event(_ name: String) {
    logger.notice("run=\(runID, privacy: .public) event=\(name, privacy: .public)")
  }
}
