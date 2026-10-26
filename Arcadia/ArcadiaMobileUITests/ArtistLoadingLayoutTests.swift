import XCTest

final class ArtistLoadingLayoutTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testArtistSongLoadingPreservesRowPositions() {
    let app = XCUIApplication()
    let namespace = UUID().uuidString
    app.launchArguments = ["-arcadia.library.destination.\(namespace)", "artists"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "delayed-library"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = namespace
    app.launchEnvironment["ARCADIA_RUN_ID"] =
      ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "artist-loading-layout"
    app.launch()
    let artist = app.buttons["artist.fixture-artist-1"]
    XCTAssertTrue(artist.waitForExistence(timeout: 10))
    artist.tap()
    let loading = app.descendants(matching: .any).matching(identifier: "artist-songs.loading").firstMatch
    XCTAssertTrue(loading.waitForExistence(timeout: 5))
    let reservedTop = loading.frame.minY
    let reservedRowPitch = (loading.frame.height + 8 + 16) / 6
    capture(app, "Artist songs - loading")
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    let first = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1").firstMatch
    let second = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-2").firstMatch
    capture(app, "Artist songs - loaded")
    XCTAssertEqual(first.frame.minY, reservedTop, accuracy: 1)
    XCTAssertEqual(second.frame.minY - first.frame.minY, reservedRowPitch, accuracy: 1)
    XCTAssertFalse(loading.exists)
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
