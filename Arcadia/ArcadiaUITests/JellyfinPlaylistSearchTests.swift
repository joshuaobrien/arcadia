import AppKit
import XCTest

final class JellyfinPlaylistSearchTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealSearchNavigatesEveryCategoryAndPlaylistConfirmKeepsOrderedDuplicates() throws {
    let file = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Requires disposable Jellyfin; not integration acceptance.")
    }
    let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: file))
    defer { NSPasteboard.general.clearContents() }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_RUN_ID"] =
      ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "real-playlists-search"
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].click()
    app.textFields["source.server"].typeText(configuration.server)
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText(configuration.username)
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(configuration.password, forType: .string))
    app.secureTextFields["source.password"].click()
    app.secureTextFields["source.password"].typeKey("a", modifierFlags: .command)
    app.secureTextFields["source.password"].typeKey("v", modifierFlags: .command)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.libraryDestination("search").waitForExistence(timeout: 20))
    app.libraryDestination("search").click()
    search("First Contact", app: app)
    let song = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH 'track.' AND identifier ENDSWITH '.play'")
    ).firstMatch
    let searchScroll = app.scrollViews["search.results.scroll"]
    for _ in 0..<12 {
      if song.exists && song.isHittable { break }
      searchScroll.scroll(byDeltaX: 0, deltaY: -450)
    }
    XCTAssertTrue(song.waitForExistence(timeout: 15))
    let searchShot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    searchShot.name = "Real Jellyfin search - matching song with shared actions"
    searchShot.lifetime = .keepAlways
    add(searchShot)
    song.click()
    XCTAssertTrue(waitForTitle("First Contact", app: app))
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    let capture = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("tmp/arcadia-audio-capture-54")
    let captureArmed = FileManager.default.fileExists(atPath: capture.appendingPathComponent("armed").path)
    var phases: [[String: Any]] = []
    if captureArmed {
      let process = try XCTUnwrap(
        NSRunningApplication.runningApplications(withBundleIdentifier: "tokyo.drift.Arcadia.Development").first)
      try JSONSerialization.data(withJSONObject: ["pid": Int(process.processIdentifier)]).write(
        to: capture.appendingPathComponent("target.json"))
      XCTAssertTrue(waitForFile(capture.appendingPathComponent("capture-ready"), timeout: 30))
      phase("search-song", phases: &phases)
    }
    app.buttons["player.pause"].click()
    if captureArmed { phase("paused", phases: &phases) }
    search("Fixture Artist", app: app)
    category("artists", app: app)
    let artist = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search.artist.'")).firstMatch
    XCTAssertTrue(artist.waitForExistence(timeout: 15))
    artist.click()
    XCTAssertTrue(app.scrollViews["artist.detail.scroll"].waitForExistence(timeout: 15))
    app.libraryDestination("songs").click()
    app.libraryDestination("search").click()
    // Search retains its path. Return through the native navigation button.
    if !app.textFields["search.query"].exists { app.buttons["Back"].firstMatch.click() }
    search("Orb Sessions", app: app)
    category("albums", app: app)
    let album = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search.album.'")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 15))
    album.click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 15))
    app.buttons["library.back"].click()
    search("Fixture Mix", app: app)
    category("playlists", app: app)
    let playlist = app.buttons["search.playlist.\(configuration.playlistID)"]
    XCTAssertTrue(playlist.waitForExistence(timeout: 15))
    playlist.click()
    XCTAssertTrue(app.buttons["playlist.play"].waitForExistence(timeout: 15))
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    let actions = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH 'track.' AND identifier ENDSWITH '.actions'")
    ).firstMatch
    XCTAssertTrue(actions.waitForExistence(timeout: 5))
    actions.click()
    app.menuItems["Add to Queue"].click()
    app.buttons["queue.toggle"].click()
    let added = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'queue.entry.'"))
      .firstMatch
    XCTAssertTrue(added.waitForExistence(timeout: 5))
    let addedOccurrence = added.identifier
    let currentOccurrence = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'queue.current.'"))
      .firstMatch.identifier
    app.buttons["queue.toggle"].click()
    app.buttons["playlist.play"].click()
    XCTAssertTrue(app.sheets.buttons["Replace Queue"].waitForExistence(timeout: 15))
    app.sheets.buttons["Cancel"].click()
    app.buttons["queue.toggle"].click()
    XCTAssertTrue(
      app.descendants(matching: .any).matching(identifier: addedOccurrence).firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.staticTexts[currentOccurrence].exists, "Cancel preserves the exact current and manually added occurrences")
    XCTAssertEqual(
      app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'queue.entry.'")).count, 1)
    app.buttons["queue.toggle"].click()
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    XCTAssertTrue(app.buttons["player.resume"].exists)
    app.buttons["playlist.play"].click()
    XCTAssertTrue(app.sheets.buttons["Replace Queue"].waitForExistence(timeout: 15))
    app.sheets.buttons["Replace Queue"].click()
    XCTAssertTrue(waitForTitle("Persistent State", app: app))
    if captureArmed { phase("playlist-first", phases: &phases) }
    app.buttons["player.pause"].click()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 10))
    app.buttons["queue.toggle"].click()
    let queueScroll = app.scrollViews["queue.scroll"]
    XCTAssertTrue(queueScroll.waitForExistence(timeout: 5))
    var seen = Set<String>()
    var orderedTitles: [String] = []
    for _ in 0..<16 {
      let viewport = queueScroll.frame
      let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'queue.entry.'"))
        .allElementsBoundByAccessibilityElement
        .map { (element: $0, frame: $0.frame) }
        .filter { $0.frame.intersects(viewport) }.sorted { $0.frame.minY < $1.frame.minY }
      for row in rows where seen.insert(row.element.identifier).inserted { orderedTitles.append(row.element.label) }
      if seen.count == 23 { break }
      queueScroll.scroll(byDeltaX: 0, deltaY: -250)
    }
    let expected = Array(
      repeating: ["Persistent State", "First Contact", "Persistent State", "Range Request"], count: 6
    ).flatMap { $0 }
    XCTAssertEqual(
      orderedTitles, Array(expected.dropFirst()),
      "Confirmed Play must include all 24 declared occurrences, including page two")
    app.buttons["queue.toggle"].click()
    app.buttons["player.resume"].click()
    app.buttons["player.next"].click()
    XCTAssertTrue(waitForTitle("First Contact", app: app))
    if captureArmed { phase("playlist-second", phases: &phases) }
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.97)
    XCTAssertTrue(waitForTitle("Persistent State", app: app))
    if captureArmed {
      phase("duplicate-natural", phases: &phases)
      try JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted]).write(
        to: capture.appendingPathComponent("phases.json"))
      try Data().write(to: capture.appendingPathComponent("done"))
      XCTAssertTrue(waitForFile(capture.appendingPathComponent("results.json"), timeout: 10))
    }
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = "Real Jellyfin playlist - duplicate occurrence retained after confirmed replacement"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  @MainActor
  private func phase(_ name: String, phases: inout [[String: Any]]) {
    let start = Date().timeIntervalSince1970
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 2))
    phases.append(["name": name, "start": start, "end": Date().timeIntervalSince1970])
  }

  private func waitForFile(_ file: URL, timeout: Double) -> Bool {
    let deadline = Date(timeIntervalSinceNow: timeout)
    while Date() < deadline {
      if FileManager.default.fileExists(atPath: file.path) { return true }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return false
  }

  @MainActor
  private func search(_ text: String, app: XCUIApplication) {
    let field = app.textFields["search.query"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.click()
    field.typeKey("a", modifierFlags: .command)
    field.typeText(text)
  }

  @MainActor
  private func category(_ name: String, app: XCUIApplication) {
    app.revealSearchCategory(name)
  }

  @MainActor
  private func waitForTitle(_ title: String, app: XCUIApplication) -> Bool {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == %@", title), object: app.staticTexts["player.title"])
    return XCTWaiter.wait(for: [expectation], timeout: 15) == .completed
  }
}

private struct Configuration: Decodable {
  let server: String
  let username: String
  let password: String
  let playlistID: String
  let firstSongID: String
}
