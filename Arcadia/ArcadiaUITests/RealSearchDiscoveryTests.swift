import AppKit
import XCTest

final class RealSearchDiscoveryTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealEmptySongsOffersMatchingAlbumWithoutChangingQuery() throws {
    let file = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Requires disposable Jellyfin; not integration acceptance.")
    }
    let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: file))
    defer { NSPasteboard.general.clearContents() }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].click()
    app.textFields["source.server"].typeText(configuration.server)
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText(configuration.username)
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(configuration.password, forType: .string))
    app.secureTextFields["source.password"].click()
    app.secureTextFields["source.password"].typeKey("v", modifierFlags: .command)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.staticTexts["library.destination.search"].waitForExistence(timeout: 20))
    app.staticTexts["library.destination.search"].click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("Orb Sessions")
    let empty = app.staticTexts["search.songs.empty"]
    XCTAssertTrue(empty.waitForExistence(timeout: 15))
    capture(app, "Real Jellyfin Orb Sessions - empty Songs with matching album")
    XCTAssertEqual(empty.value as? String, "No songs found")
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    let albums = app.buttons["search.show.albums"]
    XCTAssertTrue(albums.waitForExistence(timeout: 15))
    albums.click()
    let album = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search.album.'")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 15))
    XCTAssertEqual(query.value as? String, "Orb Sessions")
    album.click()
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
