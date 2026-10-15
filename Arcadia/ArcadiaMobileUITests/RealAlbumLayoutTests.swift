import UIKit
import XCTest

final class RealAlbumLayoutTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealJellyfinAlbumsRemainBrowsableAndPlayableInCompactLayout() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let file = documents.appendingPathComponent("arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Requires disposable Jellyfin; not integration acceptance.")
    }
    let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: file))
    defer { UIPasteboard.general.string = nil }
    addUIInterruptionMonitor(withDescription: "Native Passwords save prompt") { prompt in
      if prompt.buttons["Not Now"].exists {
        prompt.buttons["Not Now"].tap()
        return true
      }
      return false
    }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].tap()
    app.textFields["source.server"].typeText(configuration.server)
    app.textFields["source.username"].tap()
    app.textFields["source.username"].typeText(configuration.username)
    UIPasteboard.general.string = configuration.password
    let password = app.secureTextFields["source.password"]
    password.tap()
    password.press(forDuration: 1.2)
    let paste = app.menuItems["Paste"].firstMatch
    if paste.waitForExistence(timeout: 3) {
      paste.tap()
    } else {
      XCTAssertTrue(app.buttons["Paste"].waitForExistence(timeout: 3))
      app.buttons["Paste"].tap()
    }
    app.buttons["source.connect"].tap()
    XCTAssertTrue(app.tabBars.buttons["Search"].waitForExistence(timeout: 20))
    let system = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
    if system.buttons["Not Now"].waitForExistence(timeout: 3) {
      system.buttons["Not Now"].tap()
    }
    app.tabBars.buttons["Library"].tap()
    XCTAssertTrue(app.segmentedControls.buttons["Albums"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Albums"].tap()
    let albums = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "album."))
    XCTAssertTrue(albums.element(boundBy: 1).waitForExistence(timeout: 15))
    let first = albums.element(boundBy: 0)
    let second = albums.element(boundBy: 1)
    capture(app, "Real Jellyfin album grid - regular phone")
    XCTAssertEqual(first.frame.minY, second.frame.minY, accuracy: 2)
    XCTAssertTrue(first.isHittable && second.isHittable)
    first.tap()
    let title = app.staticTexts["album.title"]
    let artist = app.staticTexts["album.artist"]
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    XCTAssertTrue(artist.exists)
    XCTAssertTrue(app.windows.firstMatch.frame.contains(title.frame))
    XCTAssertTrue(app.windows.firstMatch.frame.contains(artist.frame))
    let play = app.buttons["album.play"]
    XCTAssertTrue(play.isHittable && play.isEnabled)
    capture(app, "Real Jellyfin album detail - readable shared metadata and actions")
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    app.buttons["player.pause"].tap()
    app.buttons["albums.back"].tap()
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["player.resume"].exists)
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
  }
}
