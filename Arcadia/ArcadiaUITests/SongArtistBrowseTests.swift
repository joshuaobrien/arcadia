import XCTest

final class SongArtistBrowseTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testSongAlbumAndArtistPillsShareMetadataLine() {
    let app = launch("success")
    let artist = app.buttons["track.fixture-1-track-1.artist.fixture-artist-1"]
    let album = app.buttons["track.fixture-1-track-1.album"]
    XCTAssertTrue(artist.waitForExistence(timeout: 10))
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    XCTAssertEqual(artist.frame.midY, album.frame.midY, accuracy: 1,
                   "Album and artist pills should share the line below the song title")
    XCTAssertGreaterThan(album.frame.minX, artist.frame.maxX)
    capture(app, "Songs - aligned metadata pills")
    album.click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10),
                  "The aligned album pill still opens the album")
  }

  @MainActor
  func testSongsLeadAndArtistNavigationPreservesPlayback() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_RUN_ID"] =
      ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "songs-artists-ui"
    app.launch()
    capture(app, "Songs - initial destination")
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 10))
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.click()
    XCTAssertTrue(app.staticTexts["player.title"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.artists"].click()
    let artist = app.buttons["artist.fixture-artist-1"]
    XCTAssertTrue(artist.waitForExistence(timeout: 10))
    XCTAssertEqual(artist.label, "Bjork")
    artist.click()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 10))
    let release = app.buttons["album.fixture-1"]
    for _ in 0..<6 {
      if release.exists && release.isHittable { break }
      app.scrollViews["artist.detail.scroll"].scroll(byDeltaX: 0, deltaY: -300)
    }
    XCTAssertTrue(release.exists && release.isHittable)
    XCTAssertTrue(app.staticTexts["player.title"].exists)
    capture(app, "Artist - shared songs and releases")
    app.staticTexts["library.destination.songs"].click()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["player.title"].exists)
  }

  @MainActor
  func testEmptySongsAndArtists() {
    let app = launch("empty")
    XCTAssertTrue(app.staticTexts["songs.empty.title"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.artists"].click()
    XCTAssertTrue(app.staticTexts["artists.empty.title"].waitForExistence(timeout: 10))
    capture(app, "Artists - empty library")
  }

  @MainActor
  func testSongsAndArtistsRecoverFromRequestFailure() {
    let app = launch("failure-then-success")
    XCTAssertTrue(app.staticTexts["songs.error"].waitForExistence(timeout: 10))
    app.buttons["songs.retry"].click()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.artists"].click()
    XCTAssertTrue(app.staticTexts["artists.error"].waitForExistence(timeout: 10))
    app.buttons["artists.retry"].click()
    XCTAssertTrue(app.buttons["artist.fixture-artist-1"].waitForExistence(timeout: 10))
  }

  @MainActor
  func testPagedSongsAndArtistsRestoreTheirDestination() {
    let app = launch("two-page")
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["songs.count"].value as? String, "24 songs")
    let lastSong = app.buttons["track.fixture-8-track-3.play"]
    for _ in 0..<16 {
      if lastSong.exists && lastSong.isHittable { break }
      app.scrollViews["songs.scroll"].scroll(byDeltaX: 0, deltaY: -400)
    }
    XCTAssertTrue(lastSong.exists && lastSong.isHittable)
    XCTAssertEqual(app.staticTexts["songs.count"].value as? String, "24 songs")
    XCTAssertEqual(app.buttons.matching(identifier: "track.fixture-8-track-3.play").count, 1)
    app.staticTexts["library.destination.artists"].click()
    XCTAssertTrue(app.staticTexts["artists.count"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["artist.fixture-artist-1"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["artists.count"].value as? String, "24 artists")
    let lastArtist = app.buttons["artist.fixture-artist-24"]
    for _ in 0..<16 {
      if lastArtist.exists && lastArtist.isHittable { break }
      app.scrollViews["artists.scroll"].scroll(byDeltaX: 0, deltaY: -400)
    }
    XCTAssertTrue(lastArtist.exists && lastArtist.isHittable)
    XCTAssertEqual(app.staticTexts["artists.count"].value as? String, "24 artists")
    XCTAssertEqual(app.buttons.matching(identifier: "artist.fixture-artist-24").count, 1)
    capture(app, "Artists - second page without duplicate rows")
    app.staticTexts["library.destination.songs"].click()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 5))
    XCTAssertTrue(waitUntilHittable(lastSong), "Returning to Songs should preserve the browsed position")
    app.staticTexts["library.destination.artists"].click()
    XCTAssertTrue(waitUntilHittable(lastArtist), "Returning to Artists should preserve the browsed position")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["artists.count"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["songs.count"].exists)
  }

  @MainActor
  private func waitUntilHittable(_ element: XCUIElement) -> Bool {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
    return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
  }

  @MainActor
  func testLoadingWhileInitialLibraryRequestsArePending() {
    let app = launch("delayed-library")
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "songs.loading").firstMatch.waitForExistence(timeout: 5))
    let loading = app.descendants(matching: .any).matching(identifier: "songs.loading").firstMatch
    XCTAssertGreaterThan(loading.frame.height, 240, "Loading reserves several real row heights")
    XCTAssertFalse(app.buttons["track.loading.play"].exists, "Placeholders expose no fake playback actions")
    let reservedTop = loading.frame.minY
    // Six placeholders are separated by the same 12-point stack gap as real rows.
    let reservedRowPitch = (loading.frame.height + 12) / 6
    capture(app, "Songs - loading")
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    capture(app, "Songs - loaded")
    let firstRow = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1").firstMatch
    let secondRow = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-2").firstMatch
    let geometry = XCTAttachment(
      string: "Reserved top: \(reservedTop); pitch: \(reservedRowPitch); first: \(firstRow.frame); second: \(secondRow.frame)")
    geometry.name = "Loading and loaded song-row geometry"
    geometry.lifetime = .keepAlways
    add(geometry)
    XCTAssertEqual(firstRow.frame.minY, reservedTop, accuracy: 6, "The first row stays in its reserved position")
    XCTAssertEqual(secondRow.frame.minY - firstRow.frame.minY, reservedRowPitch, accuracy: 6,
                   "Loaded row spacing matches the skeleton's row pitch")
    XCTAssertFalse(loading.exists)
    app.staticTexts["library.destination.artists"].click()
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: "artists.loading").firstMatch.waitForExistence(timeout: 5))
    capture(app, "Artists - loading")
    XCTAssertTrue(app.buttons["artist.fixture-artist-1"].waitForExistence(timeout: 10))
    capture(app, "Artists - loaded")
  }

  @MainActor
  func testArtistSongLoadingPreservesRowPositions() {
    let app = launch("delayed-library", destination: "artists")
    let artist = app.buttons["artist.fixture-artist-1"]
    XCTAssertTrue(artist.waitForExistence(timeout: 10))
    artist.click()
    let loading = app.descendants(matching: .any).matching(identifier: "artist-songs.loading").firstMatch
    XCTAssertTrue(loading.waitForExistence(timeout: 5))
    let reservedTop = loading.frame.minY
    // AX excludes the first/last TrackRow's four-point outer padding.
    // Restore that padding and one gap to measure six complete 16-point-spaced pitches.
    let reservedRowPitch = (loading.frame.height + 8 + 16) / 6
    capture(app, "Artist songs - loading")
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    let firstRow = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-1").firstMatch
    let secondRow = app.descendants(matching: .any).matching(identifier: "track.fixture-1-track-2").firstMatch
    capture(app, "Artist songs - loaded")
    XCTAssertEqual(firstRow.frame.minY, reservedTop, accuracy: 1)
    XCTAssertEqual(secondRow.frame.minY - firstRow.frame.minY, reservedRowPitch, accuracy: 1,
                   "Artist song placeholders reserve the loaded row pitch")
    XCTAssertFalse(loading.exists)
  }

  @MainActor
  func testLoadingAlbumsAndTracksReservesContentUntilSuccess() {
    let app = launch("delayed-library", destination: "albums")
    let loading = app.descendants(matching: .any).matching(identifier: "albums.loading").firstMatch
    XCTAssertTrue(loading.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["albums.count"].exists, "The count and grid remain in place while loading")
    capture(app, "Albums - loading")
    let album = app.buttons["album.fixture-1"]
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    XCTAssertFalse(loading.exists)
    capture(app, "Albums - loaded")
    album.click()
    let tracks = app.descendants(matching: .any).matching(identifier: "tracks.loading").firstMatch
    XCTAssertTrue(tracks.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(tracks.frame.height, 100)
    XCTAssertFalse(app.buttons["album.play"].isEnabled)
    capture(app, "Tracks - loading")
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    XCTAssertFalse(tracks.exists)
    XCTAssertTrue(app.buttons["album.play"].isEnabled)
    capture(app, "Tracks - loaded")
  }

  @MainActor
  private func launch(_ scenario: String, destination: String? = nil) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = scenario
    app.launchEnvironment["ARCADIA_RUN_ID"] =
      ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "songs-artists-ui"
    let namespace = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = namespace
    if let destination {
      app.launchArguments += ["-arcadia.library.destination.\(namespace)", destination]
    }
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
