import XCTest

final class AlbumLayoutTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testPhoneShowsTwoAlbumsAcrossWithoutLosingNavigationOrListening() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "two-page"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.segmentedControls.buttons["Albums"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Albums"].tap()
    let first = app.buttons["album.fixture-1"]
    let second = app.buttons["album.fixture-2"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    XCTAssertTrue(second.waitForExistence(timeout: 10))
    capture(app, "Album browsing - default phone text size")
    XCTAssertEqual(first.frame.minY, second.frame.minY, accuracy: 2, "Two albums share the first row")
    XCTAssertLessThan(first.frame.maxX, second.frame.midX)
    XCTAssertTrue(first.isHittable && second.isHittable)
    first.tap()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
    app.buttons["album.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["albums.back"].tap()
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["player.resume"].exists)
    second.tap()
    XCTAssertTrue(app.staticTexts["Fixture Album 2"].firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["player.resume"].exists)
    capture(app, "Second album - browsing preserves paused listening")
  }

  @MainActor
  func testLongAlbumMetadataUsesReadablePhoneWidth() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "long-album-metadata"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.segmentedControls.buttons["Albums"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Albums"].tap()
    let album = app.buttons["album.fixture-1"]
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    album.tap()
    let title = app.staticTexts["The Extraordinary Adventures of a Very Long Album Title"].firstMatch
    let artist = app.staticTexts["The Northern Lights Orchestra with The Evening Choir"].firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    capture(app, "Long album title and artist credits - default phone text size")
    XCTAssertGreaterThanOrEqual(title.frame.width, app.windows.firstMatch.frame.width * 0.8)
    XCTAssertGreaterThanOrEqual(artist.frame.width, app.windows.firstMatch.frame.width * 0.8)
    XCTAssertGreaterThan(title.frame.height, 60, "Long title wraps instead of fitting a narrow artwork-side column")
    XCTAssertTrue(app.buttons["album.play"].isHittable)
  }

  @MainActor
  func testAccessibilityTextKeepsAlbumMetadataAndActionsReachable() {
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "long-album-metadata"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.segmentedControls.buttons["Albums"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Albums"].tap()
    let first = app.buttons["album.fixture-1"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    first.tap()
    XCTAssertTrue(app.staticTexts["The Extraordinary Adventures of a Very Long Album Title"].firstMatch.waitForExistence(timeout: 10))
    capture(app, "Long album metadata - accessibility text size")
    let play = app.buttons["album.play"]
    for _ in 0..<12 {
      if play.exists && play.isHittable && app.windows.firstMatch.frame.contains(play.frame) { break }
      app.swipeUp()
    }
    XCTAssertTrue(play.isHittable && app.windows.firstMatch.frame.contains(play.frame))
    let firstTrack = app.buttons["track.fixture-1-track-1.play"]
    for _ in 0..<8 {
      if firstTrack.exists && firstTrack.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(firstTrack.isHittable)
    firstTrack.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    capture(app, "Album actions and first track remain reachable at accessibility text size")
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
