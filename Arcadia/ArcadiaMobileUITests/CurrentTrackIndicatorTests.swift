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
    XCTAssertEqual(first.value as? String, "Playing")
    app.buttons["player.pause"].tap()
    XCTAssertEqual(first.value as? String, "Paused")
    capture(app, "Song library - current track remains marked while paused")
    app.buttons["track.fixture-1-track-2.actions"].tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.next"].tap()
    let second = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-2.playback").firstMatch
    XCTAssertTrue(second.waitForExistence(timeout: 10))
    XCTAssertFalse(first.exists)
    XCTAssertEqual(second.value as? String, "Playing")
    capture(app, "Song library - next track replaces the old current marker")
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
