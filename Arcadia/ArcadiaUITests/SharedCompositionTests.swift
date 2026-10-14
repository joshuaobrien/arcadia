import XCTest

final class SharedCompositionTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testWindowTitleFollowsActiveLibraryDestination() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.search"].click()
    XCTAssertTrue(app.textFields["search.query"].waitForExistence(timeout: 5))
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Active Search window title"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    XCTAssertEqual(app.windows.firstMatch.title, "Search")
    app.staticTexts["library.destination.songs"].click()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.windows.firstMatch.title, "Songs")
  }

  @MainActor
  func testPagedPlaylistCountDistinguishesLoadedSongsFromCompleteCollection() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "two-page"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["library.destination.playlists"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.playlists"].click()
    XCTAssertTrue(app.buttons["playlist.fixture-playlist-1"].waitForExistence(timeout: 10))
    app.buttons["playlist.fixture-playlist-1"].click()
    let count = app.staticTexts["playlist.count"]
    XCTAssertTrue(count.waitForExistence(timeout: 10))
    XCTAssertEqual(count.value as? String, "20 songs loaded")
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Playlist count accurately describes loaded page"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let scroll = app.scrollViews["playlist.scroll"]
    let last = app.descendants(matching: .any).matching(identifier: "playlist.entry.fixture-occurrence-24").firstMatch
    for _ in 0..<12 {
      if last.exists && last.isHittable && scroll.frame.contains(last.frame) { break }
      scroll.scroll(byDeltaX: 0, deltaY: -500)
    }
    XCTAssertTrue(last.exists && last.isHittable && scroll.frame.contains(last.frame))
    for _ in 0..<12 {
      if count.exists && count.isHittable && scroll.frame.contains(count.frame) { break }
      scroll.scroll(byDeltaX: 0, deltaY: 500)
    }
    XCTAssertEqual(count.value as? String, "24 songs")
  }

  @MainActor
  func testAccessibleSeekingPreservesPausedPlayback() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].click()
    let slider = app.sliders["player.seek"]
    XCTAssertTrue(slider.waitForExistence(timeout: 5))
    slider.adjust(toNormalizedSliderPosition: 0.5)
    let elapsed = app.staticTexts["player.elapsed"]
    let midpoint = NSPredicate { _, _ in
      guard let text = elapsed.value as? String else { return false }
      let parts = text.split(separator: ":")
      guard parts.count == 2, let minutes = Int(parts[0]), let seconds = Int(parts[1]) else { return false }
      return (5...7).contains(minutes * 60 + seconds)
    }
    XCTAssertEqual(
      XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: midpoint, object: elapsed)], timeout: 5), .completed)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    slider.adjust(toNormalizedSliderPosition: 0)
    XCTAssertEqual(elapsed.value as? String, "0:00")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Mac accessible seeking preserves paused playback"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

}
