import XCTest

final class PlaybackTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  private func openFixtureAlbum(_ scenario: String = "success") -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = scenario
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "playback-ui"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    app.staticTexts["Albums"].click()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    return app
  }

  @MainActor
  func testAlbumSongQueueEvidence() {
    let app = openFixtureAlbum()
    app.buttons["track.fixture-1-track-2.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.scrollViews["queue.scroll"].waitForExistence(timeout: 5))
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = "Album song queue"
    shot.lifetime = .keepAlways
    add(shot)
  }

  @MainActor
  func testSelectingAlbumSongQueuesRemainderAndAdvancesNaturally() {
    let app = openFixtureAlbum()
    app.buttons["track.fixture-1-track-2.play"].click()
    let title = app.staticTexts["player.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertEqual(title.value as? String, "The Second Song")
    XCTAssertTrue(app.buttons["player.next"].isEnabled)
    expectation(for: NSPredicate(format: "value == %@", "The Third Song"), evaluatedWith: title)
    waitForExpectations(timeout: 25)
    XCTAssertFalse(app.buttons["player.next"].isEnabled)
  }

  @MainActor
  func testAlbumSongPlayMenuQueuesRemainder() {
    let app = openFixtureAlbum()
    app.descendants(matching: .any)["track.fixture-1-track-2.actions"].click()
    app.menuItems["Play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.scrollViews["queue.scroll"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows.firstMatch.label, "The Third Song")
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The Second Song")
  }

  @MainActor
  func testNowPlayingSidebarKeepsTransportVolumeAndQueueAccessible() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let song = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(song.waitForExistence(timeout: 10))
    song.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    XCTAssertFalse(app.staticTexts["NOW PLAYING"].exists)
    XCTAssertFalse(app.staticTexts["player.state"].exists)
    XCTAssertEqual(app.scrollViews["player.bar"].value as? String, "Paused")
    let title = app.staticTexts["player.title"]
    XCTAssertEqual(title.value as? String, "The First Song")
    XCTAssertEqual(app.buttons["player.album"].label, "Hyperballad")
    XCTAssertGreaterThan(title.frame.minX, song.frame.maxX)
    let sidebar = app.scrollViews["player.bar"]
    let volume = app.sliders["player.volume"]
    for _ in 0..<5 {
      if volume.isHittable { break }
      sidebar.scroll(byDeltaX: 0, deltaY: -150)
    }
    XCTAssertTrue(volume.isHittable)
    volume.adjust(toNormalizedSliderPosition: 0.25)
    XCTAssertTrue(app.buttons["player.resume"].exists, "Volume must preserve paused intent")
    let upNext = app.buttons["player.up-next"]
    for _ in 0..<5 {
      if upNext.isHittable { break }
      sidebar.scroll(byDeltaX: 0, deltaY: -150)
    }
    XCTAssertTrue(upNext.isHittable)
    upNext.click()
    XCTAssertTrue(app.scrollViews["queue.scroll"].waitForExistence(timeout: 5))
    app.buttons["queue.toggle"].click()
    XCTAssertEqual(title.value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
  }

  @MainActor
  func testPlayerMetadataOpensArtistAndAlbumWithoutChangingPlayback() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.buttons["player.artist.fixture-artist-1"].click()
    XCTAssertTrue(app.scrollViews["artist.detail.scroll"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["player.album"].click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].exists)
    XCTAssertTrue(app.buttons["player.resume"].exists)
  }

  @MainActor
  func testAlbumAdvancesNaturallyAndSongPlayReplacesQueue() {
    let app = openFixtureAlbum()
    app.buttons["album.play"].click()
    let title = app.staticTexts["player.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertEqual(title.value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    let advanced = NSPredicate(format: "value == %@", "The Second Song")
    expectation(for: advanced, evaluatedWith: title)
    waitForExpectations(timeout: 20)
    app.buttons["player.next"].click()
    XCTAssertEqual(title.value as? String, "The Third Song")
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertEqual(title.value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.next"].isEnabled)
  }

  @MainActor
  func testPlaybackFailureIsVisibleAndCanBeRetried() {
    let app = openFixtureAlbum("playback-failure")
    app.buttons["album.play"].click()
    XCTAssertTrue(app.staticTexts["player.error"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.scrollViews["player.bar"].value as? String, "Failed")
    XCTAssertFalse(app.buttons["player.pause"].exists)
    app.buttons["player.retry"].click()
    XCTAssertTrue(app.staticTexts["player.error"].waitForExistence(timeout: 10))
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = "Playback - recoverable stream failure"
    shot.lifetime = .keepAlways
    add(shot)
  }

  @MainActor
  func testPausedResolutionDoesNotAutoplayAndReplacementWins() {
    let app = openFixtureAlbum("delayed-playback")
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 5))
    app.buttons["player.pause"].click()  // Cancel autoplay while access is still resolving.
    let paused = NSPredicate(format: "value == %@", "Paused")
    expectation(for: paused, evaluatedWith: app.scrollViews["player.bar"])
    waitForExpectations(timeout: 5)
    let settled = expectation(description: "Delayed access finishes without autoplay")
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { settled.fulfill() }
    wait(for: [settled], timeout: 5)
    XCTAssertEqual(app.scrollViews["player.bar"].value as? String, "Paused")
    XCTAssertEqual(app.staticTexts["player.elapsed"].value as? String, "0:00")
    app.buttons["track.fixture-1-track-1.play"].click()
    // Target the public track viewport explicitly; a clipped button can receive
    // XCTest's click without delivering the user's action to the song row.
    let third = app.buttons["track.fixture-1-track-3.play"]
    let tracks = app.descendants(matching: .any)["tracks.loaded"]
    for _ in 0..<4 {
      if third.isHittable && tracks.frame.contains(third.frame) { break }
      tracks.scroll(byDeltaX: 0, deltaY: -200)
    }
    XCTAssertTrue(third.isHittable && tracks.frame.contains(third.frame))
    third.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    let replacementSettled = expectation(description: "Obsolete access cannot replace newer song")
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { replacementSettled.fulfill() }
    wait(for: [replacementSettled], timeout: 5)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The Third Song")
  }

  @MainActor
  func testSongPlaybackSurvivesBrowsing() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "playback-ui"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    app.staticTexts["Albums"].click()
    let album = app.buttons["album.fixture-1"]
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    album.click()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    let before = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    before.name = "Playback - before song action"
    before.lifetime = .keepAlways
    add(before)
    play.click()
    let title = app.staticTexts["player.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    XCTAssertEqual(title.value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["albums.back"].click()
    XCTAssertTrue(album.waitForExistence(timeout: 5))
    XCTAssertEqual(title.value as? String, "The First Song")
    app.buttons["player.pause"].click()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    let after = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    after.name = "Playback - persistent controls while browsing"
    after.lifetime = .keepAlways
    add(after)
  }
}
