import XCTest

final class SearchDiscoveryTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testEmptySongsShowsMatchingArtistsInTheSameResults() {
    let app = launchSearch(scenario: "success", query: "Bjork")
    let artist = app.buttons["search.artist.fixture-artist-1"]
    XCTAssertTrue(artist.waitForExistence(timeout: 10))
    let empty = app.staticTexts["search.songs.empty"]
    XCTAssertTrue(empty.waitForExistence(timeout: 10))
    XCTAssertEqual(empty.value as? String, "No songs found")
    XCTAssertLessThan(artist.frame.maxY, empty.frame.minY)
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    XCTAssertEqual(app.textFields["search.query"].value as? String, "Bjork")
    let capture = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    capture.name = "Grouped search shows matching artists before empty songs"
    capture.lifetime = .keepAlways
    add(capture)
    artist.click()
    XCTAssertTrue(app.scrollViews["artist.detail.scroll"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["search.query"].exists)
    app.buttons["library.search"].click()
    XCTAssertTrue(app.textFields["search.query"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.textFields["search.query"].value as? String, "Bjork")
    XCTAssertTrue(artist.waitForExistence(timeout: 5))
  }

  @MainActor
  func testSearchFailuresAreNotReportedAsGlobalNoMatches() {
    let app = launchSearch(scenario: "failure-then-success", query: "no-such-record")
    for category in ["artists", "albums", "songs", "playlists"] {
      let error = app.staticTexts["search-\(category).error"]
      reveal(error, app: app)
      XCTAssertTrue(error.exists)
      XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
      app.buttons["search-\(category).retry"].click()
      XCTAssertTrue(app.staticTexts["search.\(category).empty"].waitForExistence(timeout: 10))
    }
    let globalEmpty = app.staticTexts["search.all.empty"]
    reveal(globalEmpty, app: app)
    XCTAssertTrue(globalEmpty.exists)
    XCTAssertEqual(app.textFields["search.query"].value as? String, "no-such-record")
  }

  @MainActor
  func testPendingSearchAndLateOldQueryCannotReplaceNewResults() {
    let app = launchSearch(scenario: "delayed-search", query: "First")
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "search.other.loading").firstMatch
        .waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    let query = app.textFields["search.query"]
    query.click()
    query.typeKey("a", modifierFlags: .command)
    query.typeKey(.delete, modifierFlags: [])
    query.typeText("Third")
    let third = app.buttons["track.fixture-1-track-3.play"]
    reveal(third, app: app)
    XCTAssertTrue(third.waitForExistence(timeout: 10))
    // Observe beyond the fixture's deliberately uncancelled old request.
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 4))
    XCTAssertTrue(third.exists)
    XCTAssertFalse(app.buttons["track.fixture-1-track-1.play"].exists)
    XCTAssertEqual(query.value as? String, "Third")
  }

  @MainActor
  func testGroupedCategoryCountIncludesUnloadedPages() {
    let app = launchSearch(scenario: "two-page", query: "Fixture Album")
    let heading = app.staticTexts["search.heading.albums"]
    XCTAssertTrue(heading.waitForExistence(timeout: 10))
    XCTAssertEqual(heading.value as? String, "23 results")
    XCTAssertFalse(app.buttons["search.album.fixture-24"].exists)
    XCTAssertFalse(app.staticTexts["search.all.empty"].exists)
    XCTAssertEqual(app.textFields["search.query"].value as? String, "Fixture Album")
  }

  @MainActor
  private func reveal(_ element: XCUIElement, app: XCUIApplication) {
    let scroll = app.scrollViews["search.results.scroll"]
    _ = scroll.waitForExistence(timeout: 10)
    scroll.scroll(byDeltaX: 0, deltaY: 5000)
    for _ in 0..<12 {
      if element.exists && element.isHittable { return }
      scroll.scroll(byDeltaX: 0, deltaY: -300)
    }
  }

  @MainActor
  private func launchSearch(scenario: String, query: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = scenario
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    app.libraryDestination("search").click()
    let field = app.textFields["search.query"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.click()
    field.typeText(query)
    return app
  }
}
