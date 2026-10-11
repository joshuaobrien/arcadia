import AppKit
import XCTest

final class SessionRestoreTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealSessionRestoresPausedWithItsDuplicateOccurrencesAndPosition() throws {
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
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.6)
    expectation(for: NSPredicate(format: "value != %@", "0:00"), evaluatedWith: app.staticTexts["player.elapsed"])
    waitForExpectations(timeout: 5)
    let position = try XCTUnwrap(app.staticTexts["player.elapsed"].value as? String)
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 6)
    let ids = rows.allElementsBoundByIndex.map(\.identifier)
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["player.title"].waitForExistence(timeout: 20))
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    XCTAssertEqual(app.staticTexts["player.elapsed"].value as? String, position)
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), ids)
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = "session-restored-paused-with-duplicate-queue"
    shot.lifetime = .keepAlways
    add(shot)
    app.buttons["player.resume"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
  }

  private struct Configuration: Decodable { let server: String; let username: String; let password: String }
}
