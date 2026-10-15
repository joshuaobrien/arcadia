import XCTest

final class SearchDiscoveryTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testEmptySongsOffersMatchingArtistsWithoutChangingSelection() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    app.staticTexts["library.destination.search"].click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("Bjork")
    let empty = app.staticTexts["search.songs.empty"]
    XCTAssertTrue(empty.waitForExistence(timeout: 10))
    let before = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    before.name = "Search empty Songs with matching artist - usability 67"
    before.lifetime = .keepAlways
    add(before)
    XCTAssertEqual(empty.value as? String, "No songs found")
    let artists = app.buttons["search.show.artists"]
    XCTAssertTrue(artists.waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    artists.click()
    XCTAssertTrue(app.buttons["search.artist.fixture-artist-1"].waitForExistence(timeout: 10))
    XCTAssertEqual(query.value as? String, "Bjork")
    let capture = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    capture.name = "Search preserves query and explicitly navigates to matching artists"
    capture.lifetime = .keepAlways
    add(capture)
  }
}
