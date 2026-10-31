import XCTest

final class MacDesignTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  private func albumWithPausedPlayer() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let window = app.windows.firstMatch
    XCTAssertTrue(window.waitForExistence(timeout: 10))
    resizeWindow(app, height: 650)
    app.staticTexts["library.destination.albums"].click()
    XCTAssertTrue(app.buttons["album.fixture-1"].waitForExistence(timeout: 10))
    app.buttons["album.fixture-1"].click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.images.matching(identifier: "artwork.loaded").firstMatch.waitForExistence(timeout: 10))
    app.buttons["album.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    return app
  }

  @MainActor
  private func resizeWindow(_ app: XCUIApplication, height: CGFloat) {
    let window = app.windows.firstMatch
    let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
      .withOffset(CGVector(dx: -2, dy: -2))
    corner.press(
      forDuration: 0.1,
      thenDragTo: corner.withOffset(CGVector(dx: 900 - window.frame.width, dy: height - window.frame.height)))
  }

  @MainActor
  private func restoreWindow(_ app: XCUIApplication) {
    if app.staticTexts["queue.heading"].exists { app.buttons["player.up-next"].click() }
    resizeWindow(app, height: 450)
    app.terminate()
  }

  @MainActor
  func testAlbumWithPausedPlayer() {
    let app = albumWithPausedPlayer()
    defer { restoreWindow(app) }
    XCTAssertTrue(app.buttons["album.play"].isEnabled)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The First Song")
    let image = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    image.name = "Album with paused player"
    image.lifetime = .keepAlways
    add(image)
  }

  @MainActor
  func testBottomPlayerKeepsAlbumUsableAndControlsPlayback() {
    let app = albumWithPausedPlayer()
    defer { restoreWindow(app) }
    let bar = app.descendants(matching: .any)["player.bar"]
    let album = app.scrollViews["album.detail.scroll"]
    XCTAssertGreaterThan(bar.frame.width, app.windows.firstMatch.frame.width * 0.9)
    XCTAssertGreaterThanOrEqual(bar.frame.minY, album.frame.maxY - 1)
    XCTAssertTrue(app.buttons["album.play"].isHittable)
    app.sliders["player.volume"].adjust(toNormalizedSliderPosition: 0.4)
    app.buttons["player.next"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "The Second Song")
    app.buttons["player.up-next"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    app.buttons["player.up-next"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForNonExistence(timeout: 5))
    app.staticTexts["library.destination.search"].click()
    XCTAssertTrue(app.textFields["search.query"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["player.resume"].isHittable)
    app.staticTexts["library.destination.albums"].click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["album.title"].value as? String, "Hyperballad")
  }

  @MainActor
  func testShuffleQueuesEveryAlbumSong() {
    let app = albumWithPausedPlayer()
    defer { restoreWindow(app) }
    app.buttons["album.shuffle"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    app.buttons["player.up-next"].click()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let rows = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(rows.count, 2)
    let titles = rows.allElementsBoundByIndex.map(\.label) + [app.staticTexts["player.title"].value as? String ?? ""]
    XCTAssertEqual(Set(titles), Set(["The First Song", "The Second Song", "The Third Song"]))
  }
}
