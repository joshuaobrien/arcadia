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
    let albums = app.staticTexts["library.destination.albums"]
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
    control.click()
    waitFor("Playing", control: control)
    XCTAssertEqual(control.label, "Pause First Contact")
    control.click()
    waitFor("Paused", control: control)
    XCTAssertEqual(control.label, "Resume First Contact")
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.25)
    let elapsed = app.staticTexts["player.elapsed"]
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [
          XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "NOT (value IN %@)", ["0:00", "0:01", "0:02"]), object: elapsed)
        ],
        timeout: 5), .completed)
    capture(app, "Real Jellyfin Mac - inline paused current control")
    control.click()
    waitFor("Playing", control: control)
    control.click()
    waitFor("Paused", control: control)
    XCTAssertFalse(["0:00", "0:01", "0:02"].contains(elapsed.value as? String ?? ""))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    capture(app, "Real Jellyfin Mac - inline Resume retained the current song position")
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
