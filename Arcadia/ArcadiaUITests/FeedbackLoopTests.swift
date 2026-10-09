import XCTest

final class FeedbackLoopTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  private func launch(_ scenario: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = scenario
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "ui-tests"
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

  @MainActor
  func testSuccess() {
    let app = launch("success")
    let album = app.buttons["album.fixture-1"]
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    XCTAssertTrue(album.label.contains("Hyperballad"))
    XCTAssertEqual(app.staticTexts["albums.count"].value as? String, "1 albums")
    album.click()
    XCTAssertTrue(app.staticTexts["track.fixture-1-track-1.title"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].exists)
    XCTAssertTrue(app.images["artwork.loaded"].exists)
    XCTAssertEqual(app.staticTexts["track.fixture-1-track-1.title"].value as? String, "The First Song")
    capture(app, "Success - artwork and tracks")
    app.buttons["albums.back"].click()
    XCTAssertTrue(album.waitForExistence(timeout: 5))
    capture(app, "Success - library after back")
  }

  @MainActor
  func testEmpty() {
    let app = launch("empty")
    XCTAssertTrue(app.staticTexts["albums.count"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["albums.count"].value as? String, "0 albums")
    XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'album.'")).count, 0)
    XCTAssertFalse(app.progressIndicators["albums.loading"].exists)
    XCTAssertFalse(app.staticTexts["albums.error"].exists)
    capture(app, "Empty - loaded library")
  }

  @MainActor
  func testFailure() {
    let app = launch("failure")
    let error = app.staticTexts["albums.error"]
    XCTAssertTrue(error.waitForExistence(timeout: 10))
    XCTAssertEqual(error.value as? String, "Fixture request failed.")
    XCTAssertFalse(app.progressIndicators["albums.loading"].exists)
    XCTAssertFalse(app.staticTexts["albums.count"].exists)
    capture(app, "Failure - request error")
  }

  @MainActor
  func testTwoPage() {
    let app = launch("two-page")
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    let lastAlbum = app.buttons["album.fixture-24"]
    var observedIDs = Set<String>()
    for _ in 0..<12 {
      // Lazy grid cells can disappear between indexed AX queries while scrolling.
      // Query stable IDs individually; absence is valid, duplicate IDs are not.
      for id in 1...24 {
        let identifier = "album.fixture-\(id)"
        let count = app.buttons.matching(identifier: identifier).count
        XCTAssertLessThanOrEqual(count, 1)
        if count == 1 { observedIDs.insert(identifier) }
      }
      if lastAlbum.exists && lastAlbum.isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(lastAlbum.exists && lastAlbum.isHittable)
    XCTAssertEqual(observedIDs, Set((1...24).map { "album.fixture-\($0)" }))
    XCTAssertEqual(app.staticTexts["albums.count"].value as? String, "24 albums")
    XCTAssertEqual(app.buttons.matching(identifier: "album.fixture-24").count, 1)
    capture(app, "Two pages - final albums")
    for _ in 0..<12 {
      if app.buttons["album.fixture-1"].isHittable { break }
      app.scrollViews["albums.scroll"].scroll(byDeltaX: 0, deltaY: 500)
    }
    XCTAssertTrue(app.buttons["album.fixture-1"].isHittable)
    XCTAssertEqual(app.buttons.matching(identifier: "album.fixture-1").count, 1)
  }

  @MainActor
  func testIntegrationBrowse() throws {
    guard let baseURL = ProcessInfo.processInfo.environment["ARCADIA_INTEGRATION_URL"], !baseURL.isEmpty else {
      throw XCTSkip("Run native-loop integration before test --integration")
    }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "integration"
    app.launchEnvironment["ARCADIA_BASE_URL"] = baseURL
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "integration"
    app.launch()
    let album = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Orb Sessions'")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 30))
    album.click()
    XCTAssertTrue(app.staticTexts["First Contact"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.images["artwork.loaded"].waitForExistence(timeout: 15))
    capture(app, "Integration - real API artwork and tracks")
  }

  // Leaves the app available for native visual review without changing the behavioral suite.
  @MainActor
  func testReviewSession() throws {
    guard ProcessInfo.processInfo.environment["ARCADIA_REVIEW"] == "1" else {
      throw XCTSkip("Use native-loop view to open a review session")
    }
    let app = launch("success")
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    var previousState = ""
    for _ in 0..<90 {
      let state = app.buttons["albums.back"].exists ? "track detail" : "library"
      if state != previousState {
        capture(app, "Native review - \(state)")
        previousState = state
      }
      let tick = expectation(description: "Review tick")
      tick.isInverted = true
      wait(for: [tick], timeout: 2)
    }
    capture(app, "Review session final state")
  }
}
