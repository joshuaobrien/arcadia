import AppKit
import XCTest

final class RealCurrentTrackIndicatorTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealSongRowPausesAndResumesWithoutRestarting() throws {
    let file = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Requires the disposable Jellyfin fixture; not real-source acceptance.")
    }
    let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: file))
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
    let albums = app.libraryDestination("albums")
    XCTAssertTrue(albums.waitForExistence(timeout: 20))
    albums.click()
    XCTAssertTrue(app.staticTexts["albums.count"].waitForExistence(timeout: 20))
    let album = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Orb Sessions'")).firstMatch
    for _ in 0..<12 {
      if album.exists && album.isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(album.exists && album.isHittable)
    album.click()
    let control = app.buttons["track.\(config.firstSongID).play"]
    XCTAssertTrue(control.waitForExistence(timeout: 15))
    reveal(control, app: app)
    control.click()
    waitFor("Playing", control: control)
    XCTAssertEqual(control.label, "Pause First Contact")
    reveal(control, app: app)
    control.click()
    waitFor("Paused", control: control)
    XCTAssertEqual(control.label, "Resume First Contact")
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.25)
    let elapsed = app.staticTexts["player.elapsed"]
    let advanced = NSPredicate { _, _ in
      Self.seconds(elapsed.value as? String).map { $0 >= 3 } ?? false
    }
    XCTAssertEqual(
      XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: advanced, object: elapsed)], timeout: 5),
      .completed)
    let before = try XCTUnwrap(Self.seconds(elapsed.value as? String))
    XCTAssertGreaterThanOrEqual(before, 3)
    capture(app, "Real Jellyfin Mac - inline paused current control")
    reveal(control, app: app)
    control.click()
    waitFor("Playing", control: control)
    reveal(control, app: app)
    control.click()
    waitFor("Paused", control: control)
    let after = try XCTUnwrap(Self.seconds(elapsed.value as? String))
    XCTAssertGreaterThanOrEqual(after, 3)
    XCTAssertLessThanOrEqual(abs(after - before), 3)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    capture(app, "Real Jellyfin Mac - inline Resume retained the current song position")
  }

  @MainActor
  private func reveal(_ control: XCUIElement, app: XCUIApplication) {
    for _ in 0..<6 {
      if control.isHittable && app.windows.firstMatch.frame.contains(control.frame) { return }
      app.scrollViews["album.detail.scroll"].scroll(byDeltaX: 0, deltaY: -180)
    }
    XCTAssertTrue(control.isHittable)
  }

  nonisolated private static func seconds(_ text: String?) -> Int? {
    guard let text else { return nil }
    let parts = text.split(separator: ":")
    guard parts.count == 2, let minutes = Int(parts[0]), let seconds = Int(parts[1]),
      minutes >= 0, (0..<60).contains(seconds)
    else { return nil }
    return minutes * 60 + seconds
  }

  @MainActor
  private func waitFor(_ state: String, control: XCUIElement) {
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", state), object: control)],
        timeout: 15), .completed)
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
    let firstSongID: String
  }
}
