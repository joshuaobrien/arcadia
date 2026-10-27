import AppKit
import XCTest

final class SessionRestoreTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealSessionRestoresPausedWithItsDuplicateOccurrencesAndPosition() throws {
    try restartJourney(capturingPlayingRestart: false)
  }

  @MainActor
  func testRealPlayingRestartIsSilentUntilDeliberateResumeAndSystemCommands() throws {
    try restartJourney(capturingPlayingRestart: true)
  }

  @MainActor
  private func restartJourney(capturingPlayingRestart: Bool) throws {
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("tmp/arcadia-audio-capture-56")
    let before = root.appendingPathComponent("before")
    let after = root.appendingPathComponent("after")
    let quiet = root.appendingPathComponent("quiet")
    if capturingPlayingRestart && !FileManager.default.fileExists(atPath: before.appendingPathComponent("armed").path) {
      throw XCTSkip("Requires explicit real-source process PCM capture; not restart output acceptance.")
    }
    let configURL = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: configURL.path) else {
      throw XCTSkip("Requires explicit disposable Jellyfin; not restoration acceptance.")
    }
    let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: configURL))
    defer { NSPasteboard.general.clearContents() }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].click()
    app.textFields["source.server"].typeText(config.server)
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText(config.username)
    app.secureTextFields["source.password"].click()
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(config.password, forType: .string))
    app.secureTextFields["source.password"].typeKey("v", modifierFlags: .command)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.staticTexts["library.destination.albums"].waitForExistence(timeout: 20))
    app.staticTexts["library.destination.albums"].click()
    let album = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Orb Sessions'")).firstMatch
    for _ in 0..<12 {
      if album.exists && album.isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(album.exists && album.isHittable)
    album.click()
    let first = app.buttons.matching(NSPredicate(format: "label == %@", "Play First Contact")).firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    for _ in 0..<2 {
      app.descendants(matching: .any)["album.actions"].click()
      app.menuItems["Add Album to Queue"].click()
      XCTAssertTrue(app.staticTexts["queue.feedback"].waitForExistence(timeout: 5))
    }
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: capturingPlayingRestart ? 0.7 : 0.6)
    expectation(for: NSPredicate(format: "value != %@", "0:00"), evaluatedWith: app.staticTexts["player.elapsed"])
    waitForExpectations(timeout: 5)
    var position = try XCTUnwrap(app.staticTexts["player.elapsed"].value as? String)
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 6)
    let ids = rows.allElementsBoundByIndex.map(\.identifier)
    let currentID = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.current.")
    ).firstMatch.identifier
    if capturingPlayingRestart {
      try beginCapture(before)
      app.buttons["player.resume"].click()
      XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
      var phases: [[String: Any]] = []
      waitForPlaying(app)
      phase("before-playing", phases: &phases)
      try finishCapture(before, phases: phases)
      position = try XCTUnwrap(app.staticTexts["player.elapsed"].value as? String)
    }
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["player.title"].waitForExistence(timeout: 20))
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    if capturingPlayingRestart {
      let restored = try XCTUnwrap(app.staticTexts["player.elapsed"].value as? String)
      XCTAssertLessThanOrEqual(abs(seconds(restored) - seconds(position)), 2)
    } else {
      XCTAssertEqual(app.staticTexts["player.elapsed"].value as? String, position)
    }
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), ids)
    XCTAssertTrue(app.descendants(matching: .any)[currentID].exists)
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = "session-restored-paused-with-duplicate-queue"
    shot.lifetime = .keepAlways
    add(shot)
    if capturingPlayingRestart {
      try beginCapture(after)
      try beginCapture(quiet)
      var quietPhases: [[String: Any]] = []
      phase("restored-paused", phases: &quietPhases)
      var phases: [[String: Any]] = []
      app.typeKey("p", modifierFlags: [.command, .option])
      XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
      waitForPlaying(app)
      phase("restored-resumed", phases: &phases)
      let resumedPhase = try XCTUnwrap(phases.last)
      quietPhases.append(["name": "global-resumed", "start": resumedPhase["start"]!, "end": resumedPhase["end"]!])
      try finishCapture(quiet, phases: quietPhases)
      try postMediaKey("play-pause")
      XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
      phase("media-key-paused", phases: &phases)
      let controls = XCUIApplication(bundleIdentifier: "com.apple.controlcenter")
      controls.descendants(matching: .any)["com.apple.menuextra.controlcenter"].click()
      XCTAssertTrue(
        controls.staticTexts.matching(NSPredicate(format: "value BEGINSWITH %@", "First Contact")).firstMatch
          .waitForExistence(timeout: 5))
      controls.buttons["forward.fill"].click()
      let duplicateID = ids[0].replacingOccurrences(of: "queue.entry.", with: "queue.current.")
      XCTAssertTrue(app.descendants(matching: .any)[duplicateID].waitForExistence(timeout: 5))
      waitForPlaying(app)
      phase("system-duplicate", phases: &phases)
      controls.buttons["pause.fill"].click()
      XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
      phase("system-paused", phases: &phases)
      controls.buttons["play.fill"].click()
      XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 5))
      waitForPlaying(app)
      phase("system-resumed", phases: &phases)
      controls.buttons["forward.fill"].click()
      expectation(
        for: NSPredicate(format: "value == %@", "Persistent State"), evaluatedWith: app.staticTexts["player.title"])
      waitForExpectations(timeout: 5)
      waitForPlaying(app)
      phase("system-advanced", phases: &phases)
      controls.buttons["pause.fill"].click()
      try finishCapture(after, phases: phases)
      controls.descendants(matching: .any)["com.apple.menuextra.controlcenter"].click()
    } else {
      app.buttons["player.resume"].click()
      XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    }
  }

  @MainActor
  private func waitForPlaying(_ app: XCUIApplication) {
    expectation(
      for: NSPredicate(format: "value == %@", "Playing"), evaluatedWith: app.scrollViews["player.bar"])
    waitForExpectations(timeout: 20)
  }

  @MainActor
  private func beginCapture(_ directory: URL) throws {
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("armed"), timeout: 15))
    let process = try XCTUnwrap(
      NSRunningApplication.runningApplications(withBundleIdentifier: "tokyo.drift.Arcadia.Development").first)
    try JSONSerialization.data(withJSONObject: ["pid": Int(process.processIdentifier)]).write(
      to: directory.appendingPathComponent("target.json"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("capture-ready"), timeout: 30))
  }

  @MainActor
  private func finishCapture(_ directory: URL, phases: [[String: Any]]) throws {
    try JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted]).write(
      to: directory.appendingPathComponent("phases.json"))
    try Data().write(to: directory.appendingPathComponent("done"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("results.json"), timeout: 10))
  }

  @MainActor
  private func phase(_ name: String, phases: inout [[String: Any]]) {
    let start = Date().timeIntervalSince1970
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 2))
    phases.append(["name": name, "start": start, "end": Date().timeIntervalSince1970])
  }

  private func waitForFile(_ file: URL, timeout: Double) -> Bool {
    let deadline = Date(timeIntervalSinceNow: timeout)
    while Date() < deadline {
      if FileManager.default.fileExists(atPath: file.path) { return true }
      RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    }
    return false
  }

  @MainActor
  private func postMediaKey(_ name: String) throws {
    let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("tmp/arcadia-media-keys-56")
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("armed"), timeout: 10))
    try? FileManager.default.removeItem(at: directory.appendingPathComponent("completed"))
    try Data(name.utf8).write(to: directory.appendingPathComponent("request"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("completed"), timeout: 10))
  }

  private func seconds(_ position: String) -> Int {
    let parts = position.split(separator: ":").compactMap { Int($0) }
    return parts.count == 2 ? parts[0] * 60 + parts[1] : -1000
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
  }
}
