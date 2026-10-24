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
    capture(app, "Song library - playing row control before inline Pause")
    let first = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1.play").firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Playing", marker: first))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(waitForState("Paused", marker: first))
    capture(app, "Song library - current track remains marked while paused")
    app.buttons["track.fixture-1-track-2.actions"].tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    let queue = app.scrollViews["queue.scroll"]
    XCTAssertTrue(queue.waitForExistence(timeout: 5))
    let current = queue.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.current."))
    XCTAssertEqual(current.count, 1)
    let originalCurrentID = current.firstMatch.identifier
    let upcoming = queue.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(upcoming.count, 1)
    let originalUpcomingID = upcoming.firstMatch.identifier
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.dismiss"].tap()
    app.buttons["player.next"].tap()
    let second = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-2.play").firstMatch
    XCTAssertTrue(second.waitForExistence(timeout: 10))
    XCTAssertEqual(first.value as? String, "")
    XCTAssertTrue(waitForState("Playing", marker: second))
    capture(app, "Song library - next track replaces the old current marker")
    app.buttons["player.pause"].tap()
    XCTAssertTrue(waitForState("Paused", marker: second))
    app.buttons["player.expand"].tap()
    let seek = app.sliders["player.seek"]
    XCTAssertTrue(seek.waitForExistence(timeout: 5))
    XCTAssertTrue(seek.isEnabled)
    seek.adjust(toNormalizedSliderPosition: 0)
    let elapsed = app.staticTexts["player.elapsed"]
    XCTAssertTrue(
      XCTWaiter.wait(
        for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "0:00"), object: elapsed)],
        timeout: 5) == .completed)
    let previous = app.buttons["player.previous"]
    XCTAssertTrue(previous.waitForExistence(timeout: 5))
    XCTAssertTrue(previous.isEnabled)
    previous.tap()
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(queue.waitForExistence(timeout: 5))
    XCTAssertEqual(current.count, 1)
    XCTAssertEqual(current.firstMatch.identifier, originalCurrentID)
    XCTAssertEqual(upcoming.count, 1)
    XCTAssertEqual(upcoming.firstMatch.identifier, originalUpcomingID)
    let activeMarker = queue.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.playback."))
    XCTAssertEqual(activeMarker.count, 1)
    XCTAssertTrue(waitForState("Paused", marker: activeMarker.firstMatch))
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.dismiss"].tap()
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Paused", marker: first))
    XCTAssertEqual(second.value as? String, "")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    capture(app, "Song library - Previous restores the original paused track and occurrence")
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
  func testPhoneInlineTransportPreservesPausedPositionAndQueue() {
    let app = launchFixture()
    let first = app.buttons["track.fixture-1-track-1.play"]
    let second = app.buttons["track.fixture-1-track-2.play"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.tap()
    XCTAssertTrue(waitForState("Playing", marker: first))
    XCTAssertEqual(first.label, "Pause The First Song")
    first.tap()
    XCTAssertTrue(waitForState("Paused", marker: first))
    XCTAssertEqual(first.label, "Resume The First Song")
    app.buttons["track.fixture-1-track-2.actions"].tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.expand"].tap()
    let seek = app.sliders["player.seek"]
    XCTAssertTrue(seek.waitForExistence(timeout: 5))
    seek.adjust(toNormalizedSliderPosition: 0.5)
    let elapsed = app.staticTexts["player.elapsed"]
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [
          XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "NOT (label IN %@)", ["0:00", "0:01", "0:02"]), object: elapsed)
        ],
        timeout: 5), .completed)
    let position = phoneElapsedSeconds(elapsed)
    let original = phoneQueueSnapshot(app)
    app.buttons["player.dismiss"].tap()
    first.tap()
    XCTAssertTrue(waitForState("Playing", marker: first))
    first.tap()
    XCTAssertTrue(waitForState("Paused", marker: first))
    capture(app, "Phone inline Resume - paused song retained")
    app.buttons["player.expand"].tap()
    XCTAssertTrue(elapsed.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(phoneElapsedSeconds(elapsed), 3)
    XCTAssertLessThanOrEqual(abs(phoneElapsedSeconds(elapsed) - position), 3)
    let retained = phoneQueueSnapshot(app)
    XCTAssertEqual(retained.current, original.current)
    XCTAssertEqual(retained.upcoming, original.upcoming)
    app.buttons["player.dismiss"].tap()
    second.tap()
    XCTAssertTrue(app.buttons["queue.replace.confirm"].waitForExistence(timeout: 5))
    app.buttons["queue.replace.cancel"].tap()
    XCTAssertTrue(waitForState("Paused", marker: first))
    second.tap()
    app.buttons["queue.replace.confirm"].tap()
    XCTAssertTrue(waitForState("Playing", marker: second))
    XCTAssertEqual(first.label, "Play The First Song")
    XCTAssertEqual(second.label, "Pause The Second Song")
    capture(app, "Phone inline transport - another song uses explicit queue replacement")
  }

  @MainActor
  private func phoneQueueSnapshot(_ app: XCUIApplication) -> (current: String, upcoming: [String]) {
    app.buttons["queue.toggle"].tap()
    let queue = app.scrollViews["queue.scroll"]
    XCTAssertTrue(queue.waitForExistence(timeout: 5))
    let current = queue.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'queue.current.'"))
    let upcoming = queue.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'queue.entry.'"))
    XCTAssertEqual(current.count, 1)
    XCTAssertEqual(upcoming.count, 1)
    let result = (current.firstMatch.identifier, upcoming.allElementsBoundByIndex.map(\.identifier))
    app.navigationBars.buttons["Now Playing"].tap()
    return result
  }

  @MainActor
  private func phoneElapsedSeconds(_ elapsed: XCUIElement) -> Int {
    let parts = elapsed.label.split(separator: ":")
    guard parts.count == 2, let minutes = Int(parts[0]), let seconds = Int(parts[1]) else {
      XCTFail("Expected public elapsed time")
      return -1
    }
    return minutes * 60 + seconds
  }

  @MainActor
  private func assertPausedMarker(_ app: XCUIApplication) {
    let marker = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1.play").firstMatch
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
