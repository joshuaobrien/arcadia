import AppKit
import XCTest

final class JellyfinPreviousTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testPreviousRestartsThenReturnsToThePrecedingSongWithoutResuming() throws {
    let fixture = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: fixture.path) else {
      throw XCTSkip("Requires the explicit disposable Jellyfin fixture; not real-source acceptance.")
    }
    let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: fixture))
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
    XCTAssertTrue(app.libraryDestination("albums").waitForExistence(timeout: 20))
    app.libraryDestination("albums").click()
    XCTAssertTrue(app.staticTexts["albums.count"].waitForExistence(timeout: 20))
    let album = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Orb Sessions'")).firstMatch
    for _ in 0..<12 {
      if album.exists && album.isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(album.exists && album.isHittable)
    album.click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 15))
    app.buttons["album.play"].click()
    waitFor("Playing", identifier: "player.state", app: app)
    app.buttons["player.next"].click()
    waitFor("Persistent State", identifier: "player.title", app: app)
    waitFor("Playing", identifier: "player.state", app: app)
    app.buttons["player.pause"].click()
    waitFor("Paused", identifier: "player.state", app: app)
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.75)
    expectation(
      for: NSPredicate(format: "NOT (value IN %@)", ["0:00", "0:01", "0:02"]),
      evaluatedWith: app.staticTexts["player.elapsed"])
    waitForExpectations(timeout: 10)

    app.buttons["player.previous"].click()
    waitFor("0:00", identifier: "player.elapsed", app: app)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "Persistent State")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["player.previous"].click()
    waitFor("First Contact", identifier: "player.title", app: app)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = "Previous control - real Jellyfin returned to first song while paused"
    shot.lifetime = .keepAlways
    add(shot)
  }

  @MainActor
  private func waitFor(_ value: String, identifier: String, app: XCUIApplication) {
    let element = identifier == "player.state" ? app.scrollViews["player.bar"] : app.staticTexts[identifier]
    expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
    waitForExpectations(timeout: 15)
  }
}

private struct Configuration: Decodable {
  let server: String
  let username: String
  let password: String
}
