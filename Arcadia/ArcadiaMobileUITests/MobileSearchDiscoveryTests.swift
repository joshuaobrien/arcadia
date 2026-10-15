import UIKit
import XCTest

final class MobileSearchDiscoveryTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealEmptySongsOffersMatchingAlbumWithoutChangingQuery() throws {
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
    app.tabBars.buttons["Search"].tap()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.tap()
    query.typeText("Orb Sessions\n")
    let empty = app.staticTexts["search.songs.empty"]
    XCTAssertTrue(empty.waitForExistence(timeout: 15))
    capture(app, "Real Jellyfin Orb Sessions - empty Songs with matching album")
    XCTAssertEqual(empty.label, "No songs found")
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    let albums = app.buttons["search.show.albums"]
    XCTAssertTrue(albums.waitForExistence(timeout: 15))
    albums.tap()
    let album = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search.album.'")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 15))
    XCTAssertEqual(query.value as? String, "Orb Sessions")
    album.tap()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 15))
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
