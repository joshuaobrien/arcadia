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
    XCTAssertTrue(waitForState("Playing", marker: app.staticTexts["player.state"]))
    capture(app, "Mac song library - playing row control before inline Pause")
    play.click()
    capture(app, "Mac song library - current paused track")
    let marker = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(marker.waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Paused", marker: marker))
    play.click()
    XCTAssertTrue(waitForState("Playing", marker: marker))
    capture(app, "Mac song library - currently playing track")
  }

  @MainActor
  func testMacInlineTransportPreservesPausedPositionAndQueue() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let first = app.buttons["track.fixture-1-track-1.play"]
    let second = app.buttons["track.fixture-1-track-2.play"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.click()
    XCTAssertTrue(waitForState("Playing", marker: first))
    XCTAssertEqual(first.label, "Pause The First Song")
    first.click()
    XCTAssertTrue(waitForState("Paused", marker: first))
    XCTAssertEqual(first.label, "Resume The First Song")
    app.buttons["track.fixture-1-track-2.actions"].click()
    app.menuItems["Add to Queue"].click()
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.5)
    let elapsed = app.staticTexts["player.elapsed"]
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [
          XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "NOT (value IN %@)", ["0:00", "0:01", "0:02"]), object: elapsed)
        ],
        timeout: 5), .completed)
    let position = elapsedSeconds(elapsed)
    let original = macQueueSnapshot(app)
    first.click()
    XCTAssertTrue(waitForState("Playing", marker: first))
    first.click()
    XCTAssertTrue(waitForState("Paused", marker: first))
    XCTAssertGreaterThanOrEqual(elapsedSeconds(elapsed), 3)
    XCTAssertLessThanOrEqual(abs(elapsedSeconds(elapsed) - position), 3)
    let retained = macQueueSnapshot(app)
    XCTAssertEqual(retained.current, original.current)
    XCTAssertEqual(retained.upcoming, original.upcoming)
    capture(app, "Mac inline Resume - paused position and queue retained")
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForState("Playing", marker: second))
    XCTAssertEqual(first.label, "Play The First Song")
    XCTAssertEqual(second.label, "Pause The Second Song")
    second.click()
    XCTAssertTrue(waitForState("Paused", marker: second))
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    app.buttons["player.previous"].click()
    XCTAssertTrue(waitForState("Paused", marker: first))
    XCTAssertEqual(first.label, "Resume The First Song")
    XCTAssertEqual(second.label, "Play The Second Song")
    second.click()
    XCTAssertTrue(app.buttons["queue.replace.confirm"].waitForExistence(timeout: 5))
    app.buttons["queue.replace.cancel"].click()
    XCTAssertTrue(waitForState("Paused", marker: first))
    second.click()
    app.buttons["queue.replace.confirm"].click()
    XCTAssertTrue(waitForState("Playing", marker: second))
    XCTAssertEqual(first.label, "Play The First Song")
    capture(app, "Mac inline transport - another song uses explicit queue replacement")
  }

  @MainActor
  private func macQueueSnapshot(_ app: XCUIApplication) -> (current: String, upcoming: [String]) {
    app.buttons["queue.toggle"].click()
    let queue = app.scrollViews["queue.scroll"]
    XCTAssertTrue(queue.waitForExistence(timeout: 5))
    let current = queue.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'queue.current.'"))
    let upcoming = queue.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH 'queue.entry.'"))
    XCTAssertEqual(current.count, 1)
    XCTAssertEqual(upcoming.count, 1)
    let result = (current.firstMatch.identifier, upcoming.allElementsBoundByIndex.map(\.identifier))
    app.buttons["queue.toggle"].click()
    return result
  }

  @MainActor
  private func elapsedSeconds(_ elapsed: XCUIElement) -> Int {
    let parts = (elapsed.value as? String ?? "").split(separator: ":")
    guard parts.count == 2, let minutes = Int(parts[0]), let seconds = Int(parts[1]) else {
      XCTFail("Expected public elapsed time")
      return -1
    }
    return minutes * 60 + seconds
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
