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
    app.launch()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    return app
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
    XCTAssertFalse(app.buttons["player.next"].isEnabled)
  }

  @MainActor
  func testPlaybackFailureIsVisibleAndCanBeRetried() {
    let app = openFixtureAlbum("playback-failure")
    app.buttons["album.play"].click()
    XCTAssertTrue(app.staticTexts["player.error"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["player.state"].value as? String, "Failed")
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
    app.buttons["player.pause"].click() // Cancel autoplay while access is still resolving.
    let paused = NSPredicate(format: "value == %@", "Paused")
    expectation(for: paused, evaluatedWith: app.staticTexts["player.state"])
    waitForExpectations(timeout: 5)
    let settled = expectation(description: "Delayed access finishes without autoplay")
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { settled.fulfill() }
    wait(for: [settled], timeout: 5)
    XCTAssertEqual(app.staticTexts["player.state"].value as? String, "Paused")
    XCTAssertEqual(app.staticTexts["player.elapsed"].value as? String, "0:00")
    app.buttons["track.fixture-1-track-1.play"].click()
    // The third row requires XCTest to scroll its button fully into the track viewport.
    app.buttons["track.fixture-1-track-3.play"].click()
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
    app.launch()
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
