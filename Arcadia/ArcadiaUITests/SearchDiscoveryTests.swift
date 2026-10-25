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
    let matches = app.staticTexts["search.other.matches"]
    XCTAssertTrue(matches.exists)
    XCTAssertLessThan(matches.frame.maxY, empty.frame.minY, "Successful matches should lead the empty-category context")
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    artists.click()
    XCTAssertTrue(app.buttons["search.artist.fixture-artist-1"].waitForExistence(timeout: 10))
    XCTAssertEqual(query.value as? String, "Bjork")
    let capture = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    capture.name = "Search preserves query and explicitly navigates to matching artists"
    capture.lifetime = .keepAlways
    add(capture)
  }

  @MainActor
  func testSearchFailuresAreNotReportedAsGlobalNoMatches() {
    let app = launchSearch(scenario: "failure-then-success", query: "no-such-record")
    XCTAssertTrue(app.staticTexts["search-songs.error"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    app.buttons["search-songs.retry"].click()
    XCTAssertTrue(app.staticTexts["search.songs.empty"].waitForExistence(timeout: 10))
    for category in ["artists", "albums", "playlists"] {
      let error = app.staticTexts["search.\(category).unavailable"]
      XCTAssertTrue(error.waitForExistence(timeout: 10))
      XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
      app.buttons["search.retry.\(category)"].click()
    }
    XCTAssertTrue(app.staticTexts["search.all.empty"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textFields["search.query"].value as? String, "no-such-record")
  }

  @MainActor
  func testEmptyCategoryShowsPendingSearchAndPreservesSelectionForNewQuery() {
    let app = launchSearch(scenario: "delayed-search", query: "First")
    let artists = app.descendants(matching: .any).matching(identifier: "search.category.artists").firstMatch
    artists.click()
    XCTAssertTrue(app.staticTexts["search.artists.empty"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "search.other.loading").firstMatch.exists)
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    let query = app.textFields["search.query"]
    query.click()
    query.typeKey("a", modifierFlags: .command)
    query.typeKey(.delete, modifierFlags: [])
    query.typeText("Third")
    XCTAssertTrue(app.buttons["search.show.songs"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["search.artists.empty"].exists, "New results must respect the selected category")
    app.buttons["search.show.songs"].click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-3.play"].waitForExistence(timeout: 10))
    // The source deliberately ignores cancellation and completes First after three seconds.
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 4))
    XCTAssertTrue(app.buttons["track.fixture-1-track-3.play"].exists)
    XCTAssertFalse(app.buttons["track.fixture-1-track-1.play"].exists)
  }

  @MainActor
  func testMatchingCategoryCountDoesNotClaimLoadedPageIsTotal() {
    let app = launchSearch(scenario: "two-page", query: "Fixture Album")
    let albums = app.buttons["search.show.albums"]
    XCTAssertTrue(albums.waitForExistence(timeout: 10))
    XCTAssertEqual(albums.label, "Show Albums (23)")
    XCTAssertTrue(app.staticTexts["search.songs.empty"].exists)
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    albums.click()
    XCTAssertEqual(app.textFields["search.query"].value as? String, "Fixture Album")
  }

  @MainActor
  private func launchSearch(scenario: String, query: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = scenario
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    app.staticTexts["library.destination.search"].click()
    let field = app.textFields["search.query"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.click()
    field.typeText(query)
    return app
  }

}
