import UIKit
import XCTest

final class MobileListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }
  @MainActor
  func testLibraryStartsInSongsAndPlayerPresentationPreservesListening() throws {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.expand"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    let title = app.staticTexts["player.title"].firstMatch.label
    app.buttons["player.expand"].tap()
    XCTAssertTrue(app.buttons["player.dismiss"].waitForExistence(timeout: 5))
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.dismiss"].tap()
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    XCTAssertTrue(app.staticTexts["songs.count"].exists)
    capture(app, "Phone Library and compact transport - preserved paused song")
    app.buttons["player.expand"].tap()
    capture(app, "Phone expanded player - shared artwork and controls")
    app.buttons["queue.toggle"].tap()
    capture(app, "Phone dedicated queue - shared listening session")
  }

  @MainActor
  func testPlayerMetadataReturnsToArtistAndAlbumInLibrary() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    XCTAssertTrue(app.buttons["player.artist.fixture-artist-1"].waitForExistence(timeout: 5))
    app.buttons["player.artist.fixture-artist-1"].tap()
    XCTAssertTrue(app.scrollViews["artist.detail.scroll"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["player.dismiss"].exists)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["player.expand"].tap()
    app.buttons["player.album"].tap()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].exists)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, "The First Song")
  }

  @MainActor
  func testExpandedPlayerPrioritizesMetadataSeekingAndTransport() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    let title = app.staticTexts["player.title"].firstMatch
    let seek = app.sliders["player.seek"]
    let resume = app.buttons["player.resume"]
    XCTAssertTrue(seek.waitForExistence(timeout: 5))
    capture(app, "Expanded player - matched control hierarchy review")
    XCTAssertLessThan(title.frame.maxY, seek.frame.minY)
    XCTAssertGreaterThan(
      resume.frame.minY, seek.frame.maxY,
      "Expanded transport must have its own prominent row below seeking")
    // Allow floating-point rounding when checking the 44pt control bounds.
    let geometryTolerance = 0.000_001
    for identifier in ["player.previous", "player.resume", "player.next"] {
      let button = app.buttons[identifier]
      XCTAssertTrue(button.isHittable)
      XCTAssertGreaterThanOrEqual(button.frame.width + geometryTolerance, 44)
      XCTAssertGreaterThanOrEqual(button.frame.height + geometryTolerance, 44)
    }
    capture(app, "Expanded player - readable metadata, seeking and dedicated transport")
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    let navigationBack = app.navigationBars.buttons["Now Playing"]
    if navigationBack.exists {
      navigationBack.tap()
    } else {
      // Adaptive layouts can place native navigation in a rail.
      let railBack = app.buttons["BackButton"]
      XCTAssertTrue(railBack.exists)
      railBack.tap()
    }
    XCTAssertEqual(title.label, "The First Song")
    XCTAssertTrue(resume.isHittable)
  }

  @MainActor
  func testPagedPlaylistCountDistinguishesLoadedSongsFromCompleteCollection() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "two-page"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Playlists"].waitForExistence(timeout: 10))
    app.tabBars.buttons["Playlists"].tap()
    XCTAssertTrue(app.buttons["playlist.fixture-playlist-1"].waitForExistence(timeout: 10))
    app.buttons["playlist.fixture-playlist-1"].tap()
    let count = app.staticTexts["playlist.count"]
    XCTAssertTrue(count.waitForExistence(timeout: 10))
    XCTAssertEqual(count.label, "20 songs loaded")
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Phone playlist count accurately describes loaded page"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let scroll = app.scrollViews["playlist.scroll"]
    let last = app.descendants(matching: .any).matching(identifier: "playlist.entry.fixture-occurrence-24").firstMatch
    for _ in 0..<12 {
      if last.exists && last.isHittable && scroll.frame.contains(last.frame) { break }
      scroll.swipeUp()
    }
    XCTAssertTrue(last.exists && last.isHittable && scroll.frame.contains(last.frame))
    for _ in 0..<12 {
      if count.exists && count.isHittable && scroll.frame.contains(count.frame) { break }
      scroll.swipeDown()
    }
    XCTAssertEqual(count.label, "24 songs")
  }

  @MainActor
  func testReturningToLibraryPreservesArtistRouteAndListeningQueue() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.segmentedControls.buttons["Artists"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Artists"].tap()
    XCTAssertTrue(app.buttons["artist.fixture-artist-1"].waitForExistence(timeout: 10))
    app.buttons["artist.fixture-artist-1"].tap()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["track.fixture-1-track-2.actions"].tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    let current = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.current.")
    ).firstMatch.identifier
    let manual = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "queue.entry.", "The Second Song")
    ).firstMatch.identifier
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.dismiss"].tap()
    app.buttons["Search"].firstMatch.tap()
    XCTAssertTrue(app.textFields["search.query"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Library"].tap()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: current).firstMatch.exists)
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: manual).firstMatch.exists)
  }

  @MainActor
  func testEmptyLibraryHasAccessibleRecoveryMessage() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "empty"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["songs.empty.title"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["songs.empty.title"].label, "No songs yet")
    XCTAssertFalse(app.buttons["track.fixture-1-track-1.play"].exists)
    capture(app, "Phone empty library - accessible explanation")
  }

  @MainActor
  func testFailedSongsRequestRecoversThroughPublicRetry() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "failure-then-success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["songs.error"].waitForExistence(timeout: 10))
    let retry = app.buttons["songs.retry"]
    XCTAssertTrue(retry.exists && retry.isHittable)
    capture(app, "Phone songs request failure - public Retry")
    retry.tap()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["songs.error"].exists)
    capture(app, "Phone recovered Songs library")
  }

  @MainActor
  func testLargeTextKeepsSongActionsAndTransportReachable() {
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    XCTAssertTrue(play.isHittable)
    XCTAssertGreaterThanOrEqual(play.frame.width, 44)
    XCTAssertGreaterThanOrEqual(play.frame.height, 44)
    let title = app.staticTexts["track.fixture-1-track-1.title"]
    XCTAssertEqual(title.label, "The First Song")
    XCTAssertGreaterThanOrEqual(title.frame.height, 40)
    XCTAssertGreaterThanOrEqual(title.frame.width, app.windows.firstMatch.frame.width * 0.75)
    let duration = app.staticTexts["1:03"].firstMatch
    XCTAssertGreaterThan(duration.frame.width, duration.frame.height)
    capture(app, "Phone accessibility text size - readable shared song metadata")
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["player.pause"].isHittable)
    XCTAssertTrue(app.windows.firstMatch.frame.contains(app.buttons["player.pause"].frame))
    XCTAssertTrue(app.tabBars.buttons["Search"].isHittable)
    capture(app, "Phone accessibility text size - transport remains reachable")
  }

  @MainActor
  func testExpandedPlayerAtAccessibilityTextSizeKeepsTimesAndTransportReadable() {
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    let seek = app.sliders["player.seek"]
    XCTAssertTrue(seek.waitForExistence(timeout: 5))
    capture(app, "Expanded player accessibility XXXL - elapsed, duration and transport readability")
    let bounds = XCTAttachment(string: app.debugDescription)
    bounds.name = "Expanded player accessibility XXXL public bounds"
    bounds.lifetime = .keepAlways
    add(bounds)
    let window = app.windows.firstMatch.frame
    let traits = UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge)
    let caption = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: traits)
    let timeFont = UIFont.monospacedDigitSystemFont(ofSize: caption.pointSize, weight: .regular)
    for identifier in ["player.elapsed", "player.duration"] {
      let time = app.staticTexts[identifier]
      XCTAssertTrue(time.exists && time.isHittable)
      XCTAssertTrue(window.contains(time.frame))
      let textWidth = (time.label as NSString).size(withAttributes: [.font: timeFont]).width
      XCTAssertGreaterThanOrEqual(
        time.frame.width + 1, textWidth,
        "\(identifier) must provide enough width for its scaled time text")
      XCTAssertFalse(time.frame.intersects(seek.frame))
    }
    XCTAssertTrue(seek.isHittable)
    XCTAssertTrue(window.contains(seek.frame))
    for identifier in ["player.previous", "player.resume", "player.next"] {
      let button = app.buttons[identifier]
      if !button.isHittable { app.swipeUp() }
      XCTAssertTrue(button.isHittable)
      XCTAssertTrue(window.contains(button.frame))
      XCTAssertGreaterThanOrEqual(button.frame.width, 44)
      XCTAssertGreaterThanOrEqual(button.frame.height, 44)
    }
    capture(app, "Expanded player accessibility XXXL - reachable transport")
  }

  @MainActor
  func testPhoneSearchAcceptsTypedQueryAndShowsMatchingSong() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Search"].waitForExistence(timeout: 10))
    app.tabBars.buttons["Search"].tap()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.tap()
    query.typeText("Second\n")
    XCTAssertTrue(app.buttons["track.fixture-1-track-2.play"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["track.fixture-1-track-1.play"].exists)
    capture(app, "Phone Search - typed query produces matching shared song")
  }

  @MainActor
  func testAccessibleSeekingChangesActualPositionWithoutResumingPausedSong() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    XCTAssertTrue(app.sliders["player.seek"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons.matching(identifier: "player.resume").count, 1)
    let snapshot = XCTAttachment(string: app.debugDescription)
    snapshot.name = "Paused player public accessibility before seek"
    snapshot.lifetime = .keepAlways
    add(snapshot)
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.5)
    let after = XCTAttachment(string: app.debugDescription)
    after.name = "Paused player public accessibility after seek"
    after.lifetime = .keepAlways
    add(after)
    XCTAssertTrue(waitForElapsed(seconds: 5...7, app: app))
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    XCTAssertTrue(waitForElapsed(seconds: 0...1, app: app))
    XCTAssertTrue(app.buttons["player.resume"].exists)
    capture(app, "Phone accessible seeking - rewind preserves paused state")
  }

  @MainActor
  private func waitForElapsed(seconds: ClosedRange<Int>, app: XCUIApplication) -> Bool {
    let elapsed = app.descendants(matching: .any).matching(identifier: "player.elapsed").firstMatch
    let predicate = NSPredicate { _, _ in
      guard elapsed.exists else { return false }
      let parts = (elapsed.label.isEmpty ? (elapsed.value as? String ?? "") : elapsed.label).split(separator: ":")
      guard parts.count == 2, let minutes = Int(parts[0]), let remainder = Int(parts[1]) else { return false }
      return seconds.contains(minutes * 60 + remainder)
    }
    return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: elapsed)], timeout: 5)
      == .completed
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

}
