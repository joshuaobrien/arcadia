import XCTest

final class PlaylistSearchTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testPlaylistBrowserShowsOrderedDuplicateOccurrences() {
    let app = launch("success")
    let before = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    before.name = "Library before playlist and search destinations"
    before.lifetime = .keepAlways
    add(before)
    let destination = app.libraryDestination("playlists")
    XCTAssertTrue(destination.waitForExistence(timeout: 5))
    destination.click()
    let playlist = app.buttons["playlist.fixture-playlist-1"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 10))
    playlist.click()
    XCTAssertTrue(app.staticTexts["playlist.count"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["playlist.count"].value as? String, "4 songs")
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "playlist.entry.fixture-occurrence-1").firstMatch.exists)
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "playlist.entry.fixture-occurrence-3").firstMatch.exists)
    XCTAssertEqual(app.buttons.matching(identifier: "track.fixture-1-track-2.play").count, 2)
  }

  @MainActor
  func testPlaylistPlayUsesItsDeclaredOrderAndPreservesDuplicates() {
    let app = launch("two-page")
    XCTAssertTrue(app.libraryDestination("playlists").waitForExistence(timeout: 5))
    app.libraryDestination("playlists").click()
    let playlist = app.buttons["playlist.fixture-playlist-1"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 10))
    playlist.click()
    let play = app.buttons["playlist.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 5))
    play.click()
    let title = app.staticTexts["player.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    XCTAssertEqual(title.value as? String, "The Second Song")
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle(title, "The First Song"))
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle(title, "The Second Song"))
  }

  @MainActor
  func testLaterSongPlaySupersedesPendingPlaylistPreparation() {
    let app = launch("delayed-playlist")
    app.libraryDestination("playlists").click()
    let playlist = app.buttons["playlist.fixture-playlist-1"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 10))
    playlist.click()
    let song = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(song.waitForExistence(timeout: 10))
    app.buttons["playlist.play"].click()
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "playlist.preparing").firstMatch.waitForExistence(timeout: 5)
    )
    song.click()
    let title = app.staticTexts["player.title"]
    XCTAssertTrue(waitForTitle(title, "The First Song"))
    let finished = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"),
      object: app.descendants(matching: .any).matching(identifier: "playlist.preparing").firstMatch)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 10), .completed)
    XCTAssertEqual(
      title.value as? String, "The First Song", "A late playlist load must not replace the user's newer song choice")
  }

  @MainActor
  func testSearchFindsSongsWithoutChangingPausedPlayback() {
    let app = launch("success")
    let first = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    let destination = app.libraryDestination("search")
    XCTAssertTrue(destination.waitForExistence(timeout: 5))
    destination.click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("Third")
    let result = app.buttons["track.fixture-1-track-3.play"]
    XCTAssertTrue(result.waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["track.fixture-1-track-1.play"].exists)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
  }

  @MainActor
  func testNoMatchesAreHonestInEveryCategory() {
    let app = launch("success")
    app.libraryDestination("search").click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("no-such-record")
    for category in ["songs", "artists", "albums", "playlists"] {
      app.revealSearchCategory(category)
      XCTAssertTrue(app.staticTexts["search.\(category).empty"].waitForExistence(timeout: 10))
    }
  }

  @MainActor
  func testSearchFailureCanBeRetriedWithoutChangingQuery() {
    let app = launch("failure-then-success")
    app.libraryDestination("search").click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("First")
    XCTAssertTrue(app.staticTexts["search-songs.error"].waitForExistence(timeout: 10))
    app.buttons["search-songs.retry"].click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    XCTAssertEqual(query.value as? String, "First")
  }

  @MainActor
  func testLateOldQueryCannotReplaceNewResults() {
    let app = launch("delayed-search")
    app.libraryDestination("search").click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("First")
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "search-songs.loading").firstMatch.waitForExistence(
        timeout: 5))
    query.typeKey("a", modifierFlags: .command)
    query.typeKey(.delete, modifierFlags: [])
    query.typeText("Third")
    XCTAssertTrue(app.buttons["track.fixture-1-track-3.play"].waitForExistence(timeout: 10))
    // The fixture deliberately completes the old request after three seconds,
    // even if its caller cancels it. Observe beyond that declared completion.
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 4))
    XCTAssertTrue(app.buttons["track.fixture-1-track-3.play"].exists)
    XCTAssertFalse(app.buttons["track.fixture-1-track-1.play"].exists)
    XCTAssertEqual(query.value as? String, "Third")
  }

  @MainActor
  func testLaterSearchPageFailureRetainsResultsAndRetriesWithoutDuplicates() {
    let app = launch("paged-search-failure")
    app.libraryDestination("search").click()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.click()
    query.typeText("Fixture Song")
    let scroll = app.scrollViews["search.results.scroll"]
    let error = app.staticTexts["search-songs.error"]
    for _ in 0..<12 {
      if error.exists && error.isHittable { break }
      scroll.scroll(byDeltaX: 0, deltaY: -450)
    }
    XCTAssertTrue(error.waitForExistence(timeout: 10))
    XCTAssertTrue(
      app.buttons["track.fixture-8-track-2.play"].exists, "Loaded first-page results survive a later failure")
    app.buttons["search-songs.retry"].click()
    XCTAssertTrue(app.buttons["track.fixture-8-track-3.play"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons.matching(identifier: "track.fixture-8-track-2.play").count, 1)
    XCTAssertFalse(error.exists)
    XCTAssertEqual(query.value as? String, "Fixture Song")
  }

  @MainActor
  func testPlaylistPreparationFailureRetainsPausedSessionAndRetryLoadsAllPages() {
    let app = launch("paged-playlist-failure")
    let first = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.libraryDestination("playlists").click()
    let playlist = app.buttons["playlist.fixture-playlist-1"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 10))
    playlist.click()
    XCTAssertTrue(app.buttons["playlist.play"].waitForExistence(timeout: 10))
    app.buttons["playlist.play"].click()
    XCTAssertTrue(app.staticTexts["playlist.play.error"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["playlist.play.retry"].click()
    XCTAssertTrue(waitForTitle(app.staticTexts["player.title"], "The Second Song"))
    XCTAssertFalse(app.staticTexts["playlist.play.error"].exists)
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle(app.staticTexts["player.title"], "The First Song"))
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle(app.staticTexts["player.title"], "The Second Song"))
  }

  @MainActor
  func testExplicitNextSupersedesPendingPlaylistPreparation() {
    let app = launch("delayed-playlist")
    app.libraryDestination("albums").click()
    let album = app.buttons["album.fixture-1"]
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    album.click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
    app.buttons["album.play"].click()
    XCTAssertTrue(waitForTitle(app.staticTexts["player.title"], "The First Song"))
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle(app.staticTexts["player.title"], "The Second Song"))
    app.buttons["player.pause"].click()
    app.libraryDestination("playlists").click()
    let playlist = app.buttons["playlist.fixture-playlist-1"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 10))
    playlist.click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["playlist.play"].click()
    let preparing = app.descendants(matching: .any).matching(identifier: "playlist.preparing").firstMatch
    XCTAssertTrue(preparing.waitForExistence(timeout: 5))
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle(app.staticTexts["player.title"], "The Third Song"))
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: preparing)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 10), .completed)
    XCTAssertEqual(
      app.staticTexts["player.title"].value as? String, "The Third Song",
      "A late playlist must not replace a newer explicit Next command")
  }

  @MainActor
  func testExplicitPauseSupersedesPendingPlaylistPreparation() {
    let app = launch("delayed-playlist")
    let first = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.libraryDestination("playlists").click()
    let playlist = app.buttons["playlist.fixture-playlist-1"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 10))
    playlist.click()
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    app.buttons["player.resume"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["playlist.play"].click()
    let preparing = app.descendants(matching: .any).matching(identifier: "playlist.preparing").firstMatch
    XCTAssertTrue(preparing.waitForExistence(timeout: 5))
    app.buttons["player.pause"].click()
    let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: preparing)
    XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 10), .completed)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists, "An older async Play must not undo the user's later Pause")
  }

  @MainActor
  private func waitForTitle(_ title: XCUIElement, _ value: String) -> Bool {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: title)
    return XCTWaiter.wait(for: [expectation], timeout: 10) == .completed
  }

  @MainActor
  private func launch(_ scenario: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = scenario
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_RUN_ID"] =
      ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "playlists-search-ui"
    app.launch()
    return app
  }
}
