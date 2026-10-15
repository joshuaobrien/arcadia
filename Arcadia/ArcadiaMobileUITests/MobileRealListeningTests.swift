import UIKit
import XCTest

final class MobileRealListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealJellyfinConnectionSearchPlaybackAndQueueEditing() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let configuration = try JSONDecoder().decode(
      Configuration.self, from: Data(contentsOf: documents.appendingPathComponent("arcadia-jellyfin-fixture.json")))
    let audio = documents.appendingPathComponent("mobile-audio-57")
    if FileManager.default.fileExists(atPath: audio.path) {
      try FileManager.default.removeItem(at: audio)
    }
    try FileManager.default.createDirectory(at: audio, withIntermediateDirectories: true)
    defer { UIPasteboard.general.string = nil }
    addUIInterruptionMonitor(withDescription: "Native Passwords save prompt") { prompt in
      if prompt.buttons["Not Now"].exists {
        prompt.buttons["Not Now"].tap()
        return true
      }
      return false
    }
    let app = XCUIApplication()
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
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    XCTAssertEqual(app.buttons.matching(identifier: "source.disconnect").count, 1)
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [
          XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        ], timeout: 10), .completed)
    let nativePrompt = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    nativePrompt.name = "Full-device native post-login prompt"
    nativePrompt.lifetime = .keepAlways
    add(nativePrompt)
    let system = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
    let systemButtons = XCTAttachment(
      string: system.buttons.allElementsBoundByIndex.map(\.label).joined(separator: "\n"))
    systemButtons.name = "Observed native post-login prompt buttons"
    systemButtons.lifetime = .keepAlways
    add(systemButtons)
    if system.buttons["Not Now"].waitForExistence(timeout: 3) {
      system.buttons["Not Now"].tap()
    }
    app.tabBars.buttons["Search"].tap()
    XCTAssertTrue(app.tabBars.buttons["Search"].isSelected)
    XCTAssertTrue(app.buttons["source.disconnect"].isHittable)
    let query = app.textFields["search.query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    query.typeText("First Contact\n")
    let song = app.buttons["track.\(configuration.firstSongID).play"]
    let results = app.scrollViews["search.results.scroll"]
    XCTAssertTrue(results.waitForExistence(timeout: 15))
    for _ in 0..<12 {
      if song.exists && song.isHittable && results.frame.contains(song.frame) { break }
      results.swipeUp()
    }
    XCTAssertTrue(song.exists && song.isHittable)
    capture(app, "Real Jellyfin phone Search - First Contact")
    song.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, "First Contact")
    app.buttons["player.expand"].tap()
    XCTAssertTrue(app.sliders["player.seek"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons.matching(identifier: "player.pause").count, 1)
    let seeking = app.sliders["player.seek"]
    let transport = app.buttons["player.pause"]
    XCTAssertLessThan(app.staticTexts["player.title"].firstMatch.frame.maxY, seeking.frame.minY)
    XCTAssertGreaterThan(transport.frame.minY, seeking.frame.maxY)
    for identifier in ["player.previous", "player.pause", "player.next"] {
      let button = app.buttons[identifier]
      XCTAssertTrue(button.isHittable)
      XCTAssertGreaterThanOrEqual(button.frame.width, 44)
      XCTAssertGreaterThanOrEqual(button.frame.height, 44)
    }
    capture(app, "Real Jellyfin expanded player - metadata, seek and transport hierarchy")
    XCTAssertTrue(waitForState("Playing", app: app))
    try Data().write(to: audio.appendingPathComponent("target-request"))
    XCTAssertTrue(waitForFile(audio.appendingPathComponent("capture-ready"), timeout: 30))
    app.buttons["player.pause"].tap()
    XCTAssertTrue(waitForState("Paused", app: app))
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    XCTAssertTrue(waitForElapsed(seconds: 0...2, app: app))
    app.buttons["player.resume"].tap()
    XCTAssertTrue(waitForState("Playing", app: app))
    var phases: [[String: Any]] = []
    phase("playing", phases: &phases)
    app.buttons["player.pause"].tap()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Paused", app: app))
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    XCTAssertTrue(waitForElapsed(seconds: 0...2, app: app))
    XCTAssertTrue(waitForState("Paused", app: app))
    phase("paused", phases: &phases)
    app.buttons["player.resume"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Playing", app: app))
    phase("resumed", phases: &phases)
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.6)
    XCTAssertTrue(waitForState("Playing", app: app))
    phase("seeked", phases: &phases)
    app.buttons["player.pause"].tap()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    app.buttons["player.dismiss"].tap()
    app.tabBars.buttons["Library"].tap()
    let nextActions = app.buttons["track.\(configuration.secondSongID).actions"]
    let songs = app.scrollViews["songs.scroll"]
    for _ in 0..<12 {
      if nextActions.exists && nextActions.isHittable && songs.frame.contains(nextActions.frame) { break }
      songs.swipeUp()
    }
    XCTAssertTrue(nextActions.exists && nextActions.isHittable)
    nextActions.tap()
    app.buttons["Play Next"].tap()
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, "First Contact")
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    XCTAssertTrue(app.staticTexts["Persistent State"].firstMatch.waitForExistence(timeout: 5))
    capture(app, "Real Jellyfin phone Queue - Play Next preserves current song")
    app.navigationBars.buttons["Now Playing"].tap()
    app.buttons["player.next"].tap()
    XCTAssertTrue(waitForTitle("Persistent State", app: app))
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 5))
    XCTAssertTrue(waitForState("Playing", app: app))
    phase("advanced", phases: &phases)
    capture(app, "Real Jellyfin phone playback - Persistent State")
    try JSONSerialization.data(withJSONObject: phases).write(to: audio.appendingPathComponent("phases.json"))
    try Data().write(to: audio.appendingPathComponent("done"))
    app.buttons["player.dismiss"].tap()
    app.buttons["source.disconnect"].tap()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["player.expand"].exists)
    capture(app, "Phone source disconnected - listening session cleared")
  }

  @MainActor
  private func waitForElapsed(seconds: ClosedRange<Int>, app: XCUIApplication) -> Bool {
    let predicate = NSPredicate { _, _ in
      let parts = app.staticTexts["player.elapsed"].label.split(separator: ":")
      guard parts.count == 2, let minutes = Int(parts[0]), let remainder = Int(parts[1]) else { return false }
      return seconds.contains(minutes * 60 + remainder)
    }
    return XCTWaiter.wait(
      for: [
        XCTNSPredicateExpectation(
          predicate: predicate, object: app.staticTexts["player.elapsed"])
      ], timeout: 10) == .completed
  }

  @MainActor
  private func waitForState(_ state: String, app: XCUIApplication) -> Bool {
    return XCTWaiter.wait(
      for: [
        XCTNSPredicateExpectation(
          predicate: NSPredicate(format: "label == %@", state),
          object: app.staticTexts["player.state"].firstMatch)
      ], timeout: 15) == .completed
  }

  @MainActor
  private func waitForTitle(_ title: String, app: XCUIApplication) -> Bool {
    let predicate = NSPredicate(format: "label == %@", title)
    return XCTWaiter.wait(
      for: [
        XCTNSPredicateExpectation(
          predicate: predicate, object: app.staticTexts["player.title"].firstMatch)
      ], timeout: 10) == .completed
  }

  private func waitForFile(_ file: URL, timeout: TimeInterval) -> Bool {
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
      if FileManager.default.fileExists(atPath: file.path) { return true }
      Thread.sleep(forTimeInterval: 0.2)
    }
    return false
  }

  private func phase(_ name: String, phases: inout [[String: Any]]) {
    let start = Date().timeIntervalSince1970
    Thread.sleep(forTimeInterval: 3)
    phases.append(["name": name, "start": start + 0.8, "end": Date().timeIntervalSince1970])
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
    let firstSongID: String
    let secondSongID: String
  }
}
