import XCTest

final class SharedCompositionTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testWindowTitleFollowsActiveLibraryDestination() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.search"].click()
    XCTAssertTrue(app.textFields["search.query"].waitForExistence(timeout: 5))
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Active Search window title"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    XCTAssertTrue(app.windows.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch.exists)
    app.staticTexts["library.destination.songs"].click()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.windows.matching(NSPredicate(format: "label CONTAINS %@", "Songs")).firstMatch.exists)
  }

  @MainActor
  func testPagedPlaylistCountDistinguishesLoadedSongsFromCompleteCollection() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "two-page"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["library.destination.playlists"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.playlists"].click()
    XCTAssertTrue(app.buttons["playlist.fixture-playlist-1"].waitForExistence(timeout: 10))
    app.buttons["playlist.fixture-playlist-1"].click()
    let count = app.staticTexts["playlist.count"]
    XCTAssertTrue(count.waitForExistence(timeout: 10))
    XCTAssertEqual(count.value as? String, "20 songs loaded")
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Playlist count accurately describes loaded page"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let scroll = app.scrollViews["playlist.scroll"]
    let last = app.descendants(matching: .any).matching(identifier: "playlist.entry.fixture-occurrence-24").firstMatch
    for _ in 0..<12 {
      if last.exists && last.isHittable { break }
      scroll.scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(last.exists)
    for _ in 0..<12 {
      if count.exists && count.isHittable { break }
      scroll.scroll(byDeltaX: 0, deltaY: 500)
    }
    XCTAssertEqual(count.value as? String, "24 songs")
  }

}
