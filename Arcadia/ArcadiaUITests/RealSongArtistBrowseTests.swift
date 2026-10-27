import AppKit
import XCTest

final class RealSongArtistBrowseTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealSongsArtistsBrowseToPlay() throws {
    let fixture = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: fixture.path) else {
      throw XCTSkip("Requires the explicit disposable23artist Jellyfin fixture.")
    }
    let config = try JSONDecoder().decode(BrowseConfiguration.self, from: Data(contentsOf: fixture))
    defer { NSPasteboard.general.clearContents() }
    let app = connect(config)
    browseArtistPages(app, config: config)
    app.staticTexts["library.destination.songs"].click()
    let play = app.buttons["track.\(config.firstSongID).play"]
    scrollTo(play, in: app.scrollViews["songs.scroll"])
    capture(app, "Real Songs - paged standalone song before playing")
    play.click()
    waitForState("Playing", app: app)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    XCTAssertFalse(app.buttons["player.next"].isEnabled)
    let audio = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("tmp/arcadia-audio-capture-53")
    let armed = FileManager.default.fileExists(atPath: audio.appendingPathComponent("armed").path)
    if armed { try beginCapture(directory: audio) }
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    var phases: [[String: Any]] = []
    phase("standalone", phases: &phases)
    app.buttons["track.\(config.firstSongID).artist.\(config.artistID)"].click()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 10))
    waitForState("Playing", app: app)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "First Contact")
    phase("artist-navigation", phases: &phases)
    let artistSong = app.buttons["track.\(config.secondSongID).play"]
    scrollTo(artistSong, in: app.scrollViews["artist.detail.scroll"])
    artistSong.click()
    waitForState("Playing", app: app)
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "Persistent State")
    phase("artist-song", phases: &phases)
    if armed { try finishCapture(directory: audio, phases: phases) }
    let release = app.buttons["album.\(config.albumID)"]
    scrollTo(release, in: app.scrollViews["artist.detail.scroll"])
    capture(app, "Real Artist - songs and multiple releases while playing")
    release.click()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts["Orb Sessions"].firstMatch.value as? String, "Orb Sessions")
    XCTAssertEqual(app.staticTexts["player.title"].value as? String, "Persistent State")
    capture(app, "Real Release - contextual browsing preserves selected song")
  }

  @MainActor
  private func connect(_ config: BrowseConfiguration) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_RUN_ID"] = ProcessInfo.processInfo.environment["ARCADIA_RUN_ID"] ?? "real-song-artist-ui"
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].click()
    app.textFields["source.server"].typeText(config.server)
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText(config.username)
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(config.password, forType: .string))
    let password = app.secureTextFields["source.password"]
    password.click()
    password.typeKey("a", modifierFlags: .command)
    password.typeKey("v", modifierFlags: .command)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    return app
  }

  @MainActor
  private func browseArtistPages(_ app: XCUIApplication, config: BrowseConfiguration) {
    app.staticTexts["library.destination.artists"].click()
    let lastArtist = app.buttons["artist.\(config.lastArtistID)"]
    scrollTo(lastArtist, in: app.scrollViews["artists.scroll"])
    XCTAssertEqual(app.staticTexts["artists.count"].value as? String, "23 artists")
    XCTAssertEqual(app.buttons.matching(identifier: "artist.\(config.lastArtistID)").count, 1)
    capture(app, "Real Artists - final page with unique artist")
  }

  @MainActor
  private func scrollTo(_ element: XCUIElement, in scroll: XCUIElement) {
    for _ in 0..<16 {
      if element.exists && element.isHittable { break }
      scroll.scroll(byDeltaX: 0, deltaY: -400)
    }
    XCTAssertTrue(element.exists && element.isHittable)
  }

  @MainActor
  private func waitForState(_ state: String, app: XCUIApplication) {
    expectation(for: NSPredicate(format: "value == %@", state), evaluatedWith: app.scrollViews["player.bar"])
    waitForExpectations(timeout: 15)
  }

  @MainActor
  private func beginCapture(directory: URL) throws {
    let process = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier: "tokyo.drift.Arcadia.Development").first)
    try JSONSerialization.data(withJSONObject: ["pid": Int(process.processIdentifier)]).write(to: directory.appendingPathComponent("target.json"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("capture-ready"), timeout: 30))
  }

  private func finishCapture(directory: URL, phases: [[String: Any]]) throws {
    try JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted]).write(to: directory.appendingPathComponent("phases.json"))
    try Data().write(to: directory.appendingPathComponent("done"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("results.json"), timeout: 10))
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
  private func phase(_ name: String, phases: inout [[String: Any]]) {
    let start = Date().timeIntervalSince1970
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 2))
    phases.append(["name": name, "start": start, "end": Date().timeIntervalSince1970])
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }
}

private struct BrowseConfiguration: Decodable {
  let server: String
  let username: String
  let password: String
  let firstSongID: String
  let secondSongID: String
  let artistID: String
  let lastArtistID: String
  let albumID: String
}
