import XCTest

final class QueueTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testIdleQueueRequiresReplacementConfirmationAndCanPlayExistingOccurrence() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launch()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    app.descendants(matching: .any)["album.actions"].click()
    app.menuItems["Add Album to Queue"].click()
    XCTAssertFalse(app.staticTexts["player.title"].exists)
    revealThirdTrack(app)
    app.buttons["track.fixture-1-track-3.play"].click()
    XCTAssertTrue(app.sheets.buttons["Replace Queue"].waitForExistence(timeout: 5))
    app.sheets.buttons["Cancel"].click()
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 3)
    let selected = rows.element(boundBy: 1)
    let selectedID = selected.identifier.replacingOccurrences(of: "queue.entry.", with: "queue.current.")
    selected.buttons["queue.play"].click()
    XCTAssertTrue(app.descendants(matching: .any)[selectedID].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The Second Song")
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows.firstMatch.label, "The Third Song")
  }

  @MainActor
  func testQueueScrollSurvivesAddingAndReopening() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launch()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    for _ in 0..<8 {
      app.descendants(matching: .any)["album.actions"].click()
      app.menuItems["Add Album to Queue"].click()
    }
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let scroll = app.scrollViews["queue.scroll"]
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    let initialFirstID = rows.firstMatch.identifier
    scroll.scroll(byDeltaX: 0, deltaY: -450)
    let target = rows.allElementsBoundByIndex.first { $0.isHittable && $0.frame.minY > scroll.frame.minY + 30 && $0.frame.maxY < scroll.frame.maxY - 30 }
    XCTAssertNotNil(target)
    guard let target else { return }
    let identifier = target.identifier
    XCTAssertNotEqual(identifier, initialFirstID, "The test must actually move beyond the initial queue row")
    let position = target.frame.minY
    app.descendants(matching: .any)["album.actions"].click()
    app.menuItems["Add Album to Queue"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].exists)
    XCTAssertEqual(app.descendants(matching: .any)[identifier].frame.minY, position, accuracy: 10)
    app.buttons["queue.toggle"].click()
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(scroll.waitForExistence(timeout: 5))
    XCTAssertEqual(app.descendants(matching: .any)[identifier].frame.minY, position, accuracy: 10)
  }

  @MainActor
  func testAdditionFeedbackUndoLeavesQueueClosedAndCurrentSongUnchanged() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launch()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.descendants(matching: .any)["track.fixture-1-track-2.actions"].click()
    app.menuItems["Add to Queue"].click()
    XCTAssertTrue(app.staticTexts["queue.feedback"].waitForExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["queue.heading"].exists)
    saveWindow(app, name: "queue-added-feedback")
    app.buttons["queue.undo"].click()
    XCTAssertFalse(app.staticTexts["queue.feedback"].exists)
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry.")).count, 0)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
  }

  @MainActor
  func testManualUpcomingReplacementCanBeCanceledThenConfirmed() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launch()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.descendants(matching: .any)["track.fixture-1-track-2.actions"].click()
    app.menuItems["Add to Queue"].click()
    revealThirdTrack(app)
    app.buttons["track.fixture-1-track-3.play"].click()
    let replacement = app.sheets.buttons["Replace Queue"]
    XCTAssertTrue(replacement.waitForExistence(timeout: 5))
    app.sheets.buttons["Cancel"].click()
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    revealThirdTrack(app)
    app.buttons["track.fixture-1-track-3.play"].click()
    XCTAssertTrue(replacement.waitForExistence(timeout: 5))
    replacement.click()
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The Third Song")
    XCTAssertFalse(app.buttons["player.next"].isEnabled)
  }

  @MainActor
  func testPlayNextAndAppendPreserveCurrentSong() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launch()
    let album = app.buttons["album.fixture-1"]
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    album.click()
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    let title = app.staticTexts["player.title"]
    XCTAssertEqual(title.value as? String, "The First Song")
    app.descendants(matching: .any)["track.fixture-1-track-2.actions"].click()
    app.menuItems["Play Next"].click()
    revealThirdTrack(app)
    app.descendants(matching: .any)["track.fixture-1-track-3.actions"].click()
    app.menuItems["Add to Queue"].click()
    XCTAssertEqual(title.value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    XCTAssertFalse(app.staticTexts["queue.heading"].exists)
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 2)
    XCTAssertEqual(rows.element(boundBy: 0).label, "The Second Song")
    XCTAssertEqual(rows.element(boundBy: 1).label, "The Third Song")
  }

  @MainActor
  func testEditSpecificDuplicateWithoutChangingPausedPlayback() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launch()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    let elapsed = app.staticTexts["player.elapsed"]
    expectation(for: NSPredicate(format: "value != %@", "0:00"), evaluatedWith: elapsed)
    waitForExpectations(timeout: 10)
    app.buttons["player.pause"].click()
    let pausedPosition = elapsed.value as? String
    for _ in 0..<2 {
      app.descendants(matching: .any)["track.fixture-1-track-2.actions"].click()
      app.menuItems["Add to Queue"].click()
    }
    revealThirdTrack(app)
    app.descendants(matching: .any)["track.fixture-1-track-3.actions"].click()
    app.menuItems["Add to Queue"].click()
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 3)
    let survivingID = rows.element(boundBy: 1).identifier
    rows.element(boundBy: 0).buttons["queue.remove"].click()
    XCTAssertEqual(rows.count, 2)
    XCTAssertEqual(rows.element(boundBy: 0).identifier, survivingID)
    rows.element(boundBy: 0).buttons["queue.move-down"].click()
    XCTAssertEqual(rows.element(boundBy: 0).label, "The Third Song")
    XCTAssertEqual(rows.element(boundBy: 1).identifier, survivingID)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    XCTAssertEqual(elapsed.value as? String, pausedPosition)
    saveWindow(app, name: "queue-edited-occurrences")
  }

  @MainActor
  private func revealThirdTrack(_ app: XCUIApplication) {
    let control = app.buttons["track.fixture-1-track-3.play"]
    if !control.isHittable { app.typeKey(.escape, modifierFlags: []) }
    if !control.isHittable { app.buttons["track.fixture-1-track-1.play"].scroll(byDeltaX: 0, deltaY: -180) }
    XCTAssertTrue(control.isHittable)
  }

  @MainActor
  private func saveWindow(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
