import UIKit
import XCTest

final class RealCurrentTrackIndicatorTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealJellyfinSongShowsPlayingAndPausedCurrentTrack() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let file = documents.appendingPathComponent("arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Requires disposable Jellyfin; not integration acceptance.")
    }
    let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: file))
    defer { UIPasteboard.general.string = nil }
    addUIInterruptionMonitor(withDescription: "Native Passwords save prompt") { prompt in
      if prompt.buttons["Not Now"].exists {
        prompt.buttons["Not Now"].tap()
        return true
      }
      return false
    }
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].tap()
    app.textFields["source.server"].typeText(configuration.server)
    app.textFields["source.username"].tap()
    app.textFields["source.username"].typeText(configuration.username)
    UIPasteboard.general.string = configuration.password
    let password = app.secureTextFields["source.password"]
    password.tap()
    password.press(forDuration: 1.2)
    let paste = app.menuItems["Paste"].firstMatch
    if paste.waitForExistence(timeout: 3) {
      paste.tap()
    } else {
      XCTAssertTrue(app.buttons["Paste"].waitForExistence(timeout: 3))
      app.buttons["Paste"].tap()
    }
    app.buttons["source.connect"].tap()
    XCTAssertTrue(app.tabBars.buttons["Search"].waitForExistence(timeout: 20))
    let system = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
    if system.buttons["Not Now"].waitForExistence(timeout: 3) {
      system.buttons["Not Now"].tap()
    }
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    let play = app.buttons["track.\(configuration.firstSongID).play"]
    let songs = app.scrollViews["songs.scroll"]
    XCTAssertTrue(songs.waitForExistence(timeout: 10))
    // The configured occurrence can be beyond the first source page. Scroll
    // through the public library so its normal page loading discovers that ID.
    for _ in 0..<40 {
      if play.exists && play.isHittable && songs.frame.contains(play.frame) { break }
      songs.swipeUp()
    }
    XCTAssertTrue(play.exists && play.isHittable && songs.frame.contains(play.frame))
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    let marker = app.descendants(matching: .any).matching(
      identifier: "track.\(configuration.firstSongID).playback"
    ).firstMatch
    XCTAssertTrue(marker.waitForExistence(timeout: 10))
    XCTAssertTrue(waitForState("Playing", marker: marker))
    capture(app, "Real Jellyfin song library - currently playing song")
    app.buttons["player.pause"].tap()
    XCTAssertTrue(waitForState("Paused", marker: marker))
    capture(app, "Real Jellyfin song library - paused song remains identified")
  }

  @MainActor
  private func waitForState(_ state: String, marker: XCUIElement) -> Bool {
    XCTWaiter.wait(
      for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", state), object: marker)],
      timeout: 10
    ) == .completed
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
    let firstSongID: String
  }
}
