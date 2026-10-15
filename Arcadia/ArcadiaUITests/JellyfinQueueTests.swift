import AppKit
import XCTest

final class JellyfinQueueTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testEditedQueuePreservesPlaybackAndAdvancesWithRealOutput() throws {
    let fixture = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    let captureDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("tmp/arcadia-audio-capture-55")
    guard FileManager.default.fileExists(atPath: fixture.path),
      FileManager.default.fileExists(atPath: captureDirectory.appendingPathComponent("armed").path)
    else { throw XCTSkip("Requires explicit disposable Jellyfin and guest PCM capture; not audio acceptance.") }
    let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: fixture))
    defer { NSPasteboard.general.clearContents() }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "real-audio-ui"
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
    app.secureTextFields["source.password"].typeKey("a", modifierFlags: .command)
    app.secureTextFields["source.password"].typeKey("v", modifierFlags: .command)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.staticTexts["library.destination.albums"].waitForExistence(timeout: 20))
    app.staticTexts["library.destination.albums"].click()
    XCTAssertTrue(app.staticTexts["albums.count"].waitForExistence(timeout: 20))
    let album = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Orb Sessions'")).firstMatch
    for _ in 0..<12 {
      if album.exists && album.isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(album.exists && album.isHittable)
    album.click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 15))
    let firstPlay = app.buttons.matching(NSPredicate(format: "label == %@", "Play First Contact")).firstMatch
    firstPlay.click()
    waitForState("Playing", app: app)
    app.buttons["player.pause"].click()
    waitForState("Paused", app: app)
    let pausedPosition = app.staticTexts["player.elapsed"].value as? String
    let thirdPlay = app.buttons.matching(NSPredicate(format: "label == %@", "Play Range Request")).firstMatch
    let secondPlay = app.buttons.matching(NSPredicate(format: "label == %@", "Play Persistent State")).firstMatch
    let thirdActions = String(thirdPlay.identifier.dropLast(4)) + "actions"
    let secondActions = String(secondPlay.identifier.dropLast(4)) + "actions"
    for identifier in [thirdActions, thirdActions, secondActions] {
      let control = app.descendants(matching: .any)[identifier]
      revealTrackControl(control, app: app)
      control.click()
      app.menuItems["Add to Queue"].click()
    }
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 3)
    rows.element(boundBy: 0).buttons["queue.remove"].click()
    rows.element(boundBy: 1).buttons["queue.move-up"].click()
    XCTAssertEqual(rows.element(boundBy: 0).label, "Persistent State")
    let nextOccurrence = rows.element(boundBy: 0).identifier.replacingOccurrences(of: "queue.entry.", with: "queue.current.")
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    XCTAssertEqual(app.staticTexts["player.elapsed"].value as? String, pausedPosition)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    app.buttons["player.resume"].click()
    waitForState("Playing", app: app)
    let process = try XCTUnwrap(NSRunningApplication.runningApplications(
      withBundleIdentifier: "tokyo.drift.Arcadia.Development").first)
    try JSONSerialization.data(withJSONObject: ["pid": Int(process.processIdentifier)]).write(
      to: captureDirectory.appendingPathComponent("target.json"))
    XCTAssertTrue(waitForFile(captureDirectory.appendingPathComponent("capture-ready"), timeout: 30))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    var phases: [[String: Any]] = []
    phase("playing", seconds: 2, phases: &phases)
    app.buttons["player.pause"].click()
    waitForState("Paused", app: app)
    phase("paused", seconds: 2, phases: &phases)
    app.buttons["player.resume"].click()
    waitForState("Playing", app: app)
    phase("resumed", seconds: 2, phases: &phases)
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.75)
    waitForState("Playing", app: app)
    phase("seeked", seconds: 2, phases: &phases)
    let nextTitle = NSPredicate(format: "value == %@", "Persistent State")
    expectation(for: nextTitle, evaluatedWith: app.staticTexts["player.title"])
    waitForExpectations(timeout: 10)
    waitForState("Playing", app: app)
    XCTAssertTrue(app.descendants(matching: .any)[nextOccurrence].waitForExistence(timeout: 5))
    phase("advanced", seconds: 2, phases: &phases)
    app.buttons["player.pause"].click()
    try JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted]).write(
      to: captureDirectory.appendingPathComponent("phases.json"))
    try Data().write(to: captureDirectory.appendingPathComponent("done"))
    XCTAssertTrue(waitForFile(captureDirectory.appendingPathComponent("results.json"), timeout: 10))
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = "Jellyfin queue - edited occurrence advances with actual audio"
    shot.lifetime = .keepAlways
    add(shot)
    app.buttons["source.disconnect"].click()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["player.title"].exists)
  }

  @MainActor
  private func revealTrackControl(_ control: XCUIElement, app: XCUIApplication) {
    let tracks = app.descendants(matching: .any)["tracks.loaded"]
    for _ in 0..<4 {
      if control.isHittable && tracks.frame.contains(control.frame) { break }
      tracks.scroll(byDeltaX: 0, deltaY: -200)
    }
    XCTAssertTrue(control.isHittable && tracks.frame.contains(control.frame))
  }

  @MainActor
  private func waitForState(_ state: String, app: XCUIApplication) {
    expectation(for: NSPredicate(format: "value == %@", state), evaluatedWith: app.staticTexts["player.state"])
    waitForExpectations(timeout: 15)
  }

  @MainActor
  private func phase(_ name: String, seconds: Double, phases: inout [[String: Any]]) {
    let start = Date().timeIntervalSince1970
    RunLoop.current.run(until: Date(timeIntervalSinceNow: seconds))
    phases.append(["name": name, "start": start, "end": Date().timeIntervalSince1970])
  }

  private func waitForFile(_ file: URL, timeout: Double) -> Bool {
    let deadline = Date(timeIntervalSinceNow: timeout)
    while Date() < deadline {
      if FileManager.default.fileExists(atPath: file.path) { return true }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return false
  }
}

private struct Configuration: Decodable {
  let server: String
  let username: String
  let password: String
}
