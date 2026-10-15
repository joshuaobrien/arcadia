import XCTest

final class CurrentTrackIndicatorTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testSharedSongRowMarksPlayingAndPausedTrackAndFollowsNext() {
    let app = launchFixture()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    capture(app, "Song library - currently playing track")
    let first = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1.playback").firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Playing", marker: first))
    app.buttons["player.pause"].tap()
    XCTAssertTrue(waitForState("Paused", marker: first))
    capture(app, "Song library - current track remains marked while paused")
    app.buttons["track.fixture-1-track-2.actions"].tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.next"].tap()
    let second = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-2.playback").firstMatch
    XCTAssertTrue(second.waitForExistence(timeout: 10))
    XCTAssertFalse(first.exists)
    XCTAssertTrue(waitForState("Playing", marker: second))
    capture(app, "Song library - next track replaces the old current marker")
  }

  @MainActor
  func testPausedCurrentTrackRemainsMarkedAcrossAlbumArtistSearchAndPlaylist() {
    let app = launchFixture()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.segmentedControls.buttons["Albums"].tap()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].tap()
    assertPausedMarker(app)
    capture(app, "Album tracks - shared paused current-track cue")
    app.buttons["albums.back"].tap()
    app.segmentedControls.buttons["Artists"].tap()
    XCTAssertTrue(app.buttons["artist.fixture-artist-1"].waitForExistence(timeout: 10))
    app.buttons["artist.fixture-artist-1"].tap()
    assertPausedMarker(app)
    app.tabBars.buttons["Search"].tap()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.tap()
    query.typeText("First\n")
    assertPausedMarker(app)
    app.tabBars.buttons["Playlists"].tap()
    XCTAssertTrue(app.buttons["playlist.fixture-playlist-1"].waitForExistence(timeout: 10))
    app.buttons["playlist.fixture-playlist-1"].tap()
    assertPausedMarker(app)
    capture(app, "Playlist - shared paused current-track cue")
    XCTAssertTrue(app.buttons["player.resume"].exists)
  }

  @MainActor
  func testQueueMarksOnlyActiveOccurrenceAmongIdenticalSongs() {
    let app = launchFixture()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    for _ in 0..<2 {
      app.buttons["track.fixture-1-track-1.actions"].tap()
      app.buttons["Add to Queue"].tap()
    }
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    let queue = app.scrollViews["queue.scroll"]
    XCTAssertTrue(queue.waitForExistence(timeout: 5))
    let markers = queue.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.playback."))
    XCTAssertEqual(markers.count, 1)
    let originalMarker = markers.firstMatch.identifier
    XCTAssertTrue(waitForState("Paused", marker: markers.firstMatch))
    let upcoming = queue.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(upcoming.count, 2)
    XCTAssertNotEqual(upcoming.element(boundBy: 0).identifier, upcoming.element(boundBy: 1).identifier)
    capture(app, "Queue - one paused active occurrence and two identical upcoming songs")
    let selectedID = upcoming.element(boundBy: 0).identifier.replacingOccurrences(of: "queue.entry.", with: "")
    upcoming.element(boundBy: 0).buttons["queue.play"].tap()
    let selected = queue.descendants(matching: .any).matching(identifier: "queue.playback.\(selectedID)").firstMatch
    XCTAssertTrue(selected.waitForExistence(timeout: 10))
    XCTAssertTrue(waitForState("Playing", marker: selected))
    XCTAssertEqual(markers.count, 1)
    XCTAssertFalse(queue.descendants(matching: .any).matching(identifier: originalMarker).firstMatch.exists)
    capture(app, "Queue - selecting a duplicate moves the active-occurrence cue")
  }

  @MainActor
  private func assertPausedMarker(_ app: XCUIApplication) {
    let marker = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1.playback").firstMatch
    XCTAssertTrue(marker.waitForExistence(timeout: 10))
    XCTAssertTrue(waitForState("Paused", marker: marker))
  }

  @MainActor
  private func waitForState(_ state: String, marker: XCUIElement) -> Bool {
    let predicate = NSPredicate(format: "value == %@", state)
    return XCTWaiter.wait(
      for: [XCTNSPredicateExpectation(predicate: predicate, object: marker)], timeout: 10
    ) == .completed
  }

  @MainActor
  private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    return app
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
