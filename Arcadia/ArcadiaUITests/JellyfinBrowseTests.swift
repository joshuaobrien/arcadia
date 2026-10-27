import AppKit
import XCTest

final class JellyfinBrowseTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }
  @MainActor
  func testInvalidServerCanBeCorrected() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "jellyfin-ui"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launch()
    let server = app.textFields["source.server"]
    XCTAssertTrue(server.waitForExistence(timeout: 5))
    server.click()
    server.typeText("not a server")
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText("listener")
    app.secureTextFields["source.password"].click()
    app.secureTextFields["source.password"].typeText("invalid")
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.staticTexts["source.error"].waitForExistence(timeout: 5))
    XCTAssertTrue(server.exists)
    XCTAssertTrue(app.buttons["source.connect"].isEnabled)
  }

  @MainActor
  func testUnavailableServerCanBeRetried() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "jellyfin-ui"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launch()
    let server = app.textFields["source.server"]
    XCTAssertTrue(server.waitForExistence(timeout: 5))
    server.click()
    server.typeText("http://127.0.0.1:1")
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText("listener")
    app.secureTextFields["source.password"].click()
    app.secureTextFields["source.password"].typeText("disposable")
    app.buttons["source.connect"].click()
    let error = app.staticTexts["source.error"]
    XCTAssertTrue(error.waitForExistence(timeout: 20))
    XCTAssertTrue((error.value as? String)?.contains("Couldn't reach") == true)
    XCTAssertTrue(server.isEnabled)
    XCTAssertTrue(app.buttons["source.connect"].isEnabled)
    app.secureTextFields["source.password"].click()
    app.secureTextFields["source.password"].typeText("disposable")
    app.buttons["source.connect"].click()
    XCTAssertTrue(error.waitForExistence(timeout: 20))
    XCTAssertTrue(app.buttons["source.connect"].isEnabled)
  }

}

extension JellyfinBrowseTests {
  @MainActor
  func testRealJellyfinBrowseAndReconnect() throws {
    let configurationURL = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: configurationURL.path) else {
      throw XCTSkip("Requires the explicitly started disposable Jellyfin fixture; not integration acceptance.")
    }
    defer { NSPasteboard.general.clearContents() }
    let data = try Data(contentsOf: configurationURL)
    let configuration = try JSONDecoder().decode(FixtureConfiguration.self, from: data)
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "jellyfin-ui"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 5))
    capture(app, "Jellyfin - connection setup")
    app.textFields["source.server"].click()
    app.textFields["source.server"].typeText(configuration.server)
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText(configuration.username)
    app.secureTextFields["source.password"].click()
    app.secureTextFields["source.password"].typeText("incorrect")
    XCTAssertEqual(app.textFields["source.server"].value as? String, configuration.server)
    XCTAssertEqual(app.textFields["source.username"].value as? String, configuration.username)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.staticTexts["source.error"].waitForExistence(timeout: 20))
    XCTAssertTrue((app.staticTexts["source.error"].value as? String)?.contains("Sign-in failed") == true)
    capture(app, "Jellyfin - recoverable sign-in failure")
    paste(configuration.password, into: app.secureTextFields["source.password"])
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.libraryDestination("songs").waitForExistence(timeout: 20))
    app.libraryDestination("albums").click()
    let count = app.staticTexts["albums.count"]
    XCTAssertTrue(count.waitForExistence(timeout: 20))
    let album = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Orb Sessions'")).firstMatch
    for _ in 0..<12 {
      if album.exists && album.isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(album.exists && album.isHittable)
    XCTAssertEqual(count.value as? String, "24 albums")
    capture(app, "Jellyfin - 24 albums across two pages")
    album.click()
    XCTAssertTrue(app.staticTexts["First Contact"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts["Persistent State"].exists)
    let lastTrack = app.staticTexts["Range Request"]
    let detail = app.scrollViews["album.detail.scroll"]
    for _ in 0..<6 {
      if lastTrack.exists && lastTrack.isHittable && detail.frame.contains(lastTrack.frame) { break }
      detail.scroll(byDeltaX: 0, deltaY: -200)
    }
    XCTAssertTrue(lastTrack.exists && lastTrack.isHittable && detail.frame.contains(lastTrack.frame))
    XCTAssertTrue(app.images["artwork.loaded"].waitForExistence(timeout: 15))
    capture(app, "Jellyfin - real artwork and ordered tracks")
    app.terminate()
    app.launch()
    XCTAssertTrue(count.waitForExistence(timeout: 20), "Saved source session should restore without the password")
    app.buttons["source.disconnect"].click()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    XCTAssertTrue(
      app.textFields["source.server"].waitForExistence(timeout: 5), "Disconnect should remove saved credentials")
  }

  @MainActor
  private func paste(_ value: String, into field: XCUIElement) {
    // Avoid putting fixture credentials into XCTest's typed-text activity log.
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
    field.click()
    field.typeKey("a", modifierFlags: .command)
    field.typeKey("v", modifierFlags: .command)
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

private struct FixtureConfiguration: Decodable {
  let server: String
  let username: String
  let password: String
}
