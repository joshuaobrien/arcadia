import UIKit
import XCTest

final class ExpandedPlayerRealTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealExpandedPlayerKeepsPausedSongSeekingAndQueueAccessible() throws {
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
    app.tabBars.buttons["Search"].tap()
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.tap()
    query.typeText("Orb Sessions\n")
    let albums = app.buttons["search.category.albums"]
    XCTAssertTrue(albums.waitForExistence(timeout: 5))
    albums.tap()
    let album = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search.album.'")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 15))
    album.tap()
    XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 15))
    app.buttons["album.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    app.buttons["player.pause"].tap()
    let title = app.staticTexts["player.title"].firstMatch.label
    app.buttons["player.expand"].tap()
    let seek = app.sliders["player.seek"]
    let resume = app.buttons["player.resume"]
    XCTAssertTrue(seek.waitForExistence(timeout: 5))
    XCTAssertLessThan(app.staticTexts["player.title"].firstMatch.frame.maxY, seek.frame.minY)
    XCTAssertGreaterThan(resume.frame.minY, seek.frame.maxY)
    for identifier in ["player.previous", "player.resume", "player.next"] {
      let button = app.buttons[identifier]
      XCTAssertTrue(button.isHittable)
      XCTAssertGreaterThanOrEqual(button.frame.width, 44)
      XCTAssertGreaterThanOrEqual(button.frame.height, 44)
    }
    resume.tap()
    let playing = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == %@", "Playing"),
      object: app.staticTexts["player.state"])
    XCTAssertEqual(XCTWaiter.wait(for: [playing], timeout: 15), .completed)
    app.buttons["player.pause"].tap()
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    seek.adjust(toNormalizedSliderPosition: 0.5)
    XCTAssertTrue(resume.exists, "Seeking must preserve paused intent")
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
    capture(app, "Real Jellyfin expanded player - metadata, seeking and prominent transport")
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts[title].firstMatch.exists)
    app.navigationBars.buttons["Now Playing"].tap()
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
    capture(app, "Real Jellyfin expanded player - paused session survives queue navigation")

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
  }
}
