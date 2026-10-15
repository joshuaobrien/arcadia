import XCTest

final class CurrentTrackIndicatorTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testMacSongRowDistinguishesPausedAndPlayingCurrentTrack() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    capture(app, "Mac song library - current paused track")
    let marker = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1.playback").firstMatch
    XCTAssertTrue(marker.waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Paused", marker: marker))
    app.buttons["player.resume"].click()
    XCTAssertTrue(waitForState("Playing", marker: marker))
    capture(app, "Mac song library - currently playing track")
  }

  @MainActor
  private func waitForState(_ state: String, marker: XCUIElement) -> Bool {
    XCTWaiter.wait(
      for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", state), object: marker)],
      timeout: 10
    ) == .completed
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
