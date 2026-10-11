import XCTest

final class MobileListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }
  func testLibraryStartsInSongsAndPlayerPresentationPreservesListening() throws {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.expand"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    let title = app.staticTexts["player.title"].firstMatch.label
    app.buttons["player.expand"].tap()
    XCTAssertTrue(app.buttons["player.dismiss"].waitForExistence(timeout: 5))
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.dismiss"].tap()
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    XCTAssertTrue(app.staticTexts["songs.count"].exists)
  }

  @MainActor
  func testPagedPlaylistCountDistinguishesLoadedSongsFromCompleteCollection() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "two-page"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Playlists"].waitForExistence(timeout: 10))
    app.tabBars.buttons["Playlists"].tap()
    XCTAssertTrue(app.buttons["playlist.fixture-playlist-1"].waitForExistence(timeout: 10))
    app.buttons["playlist.fixture-playlist-1"].tap()
    let count = app.staticTexts["playlist.count"]
    XCTAssertTrue(count.waitForExistence(timeout: 10))
    XCTAssertEqual(count.label, "20 songs loaded")
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Phone playlist count accurately describes loaded page"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let scroll = app.scrollViews["playlist.scroll"]
    let last = app.descendants(matching: .any).matching(identifier: "playlist.entry.fixture-occurrence-24").firstMatch
    for _ in 0..<12 {
      if last.exists && last.isHittable && scroll.frame.contains(last.frame) { break }
      scroll.swipeUp()
    }
    XCTAssertTrue(last.exists && last.isHittable && scroll.frame.contains(last.frame))
    for _ in 0..<12 {
      if count.exists && count.isHittable && scroll.frame.contains(count.frame) { break }
      scroll.swipeDown()
    }
    XCTAssertEqual(count.label, "24 songs")
  }

  @MainActor
  func testReturningToLibraryPreservesArtistRouteAndListeningQueue() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.segmentedControls.buttons["Artists"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Artists"].tap()
    XCTAssertTrue(app.buttons["artist.fixture-artist-1"].waitForExistence(timeout: 10))
    app.buttons["artist.fixture-artist-1"].tap()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["track.fixture-1-track-2.actions"].tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    let current = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.current.")
    ).firstMatch.identifier
    let manual = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "queue.entry.", "The Second Song")
    ).firstMatch.identifier
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.dismiss"].tap()
    app.buttons["Search"].firstMatch.tap()
    XCTAssertTrue(app.textFields["search.query"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Library"].tap()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: current).firstMatch.exists)
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: manual).firstMatch.exists)
  }

}
