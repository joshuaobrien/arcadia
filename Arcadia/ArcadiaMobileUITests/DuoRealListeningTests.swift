import UIKit
import XCTest

final class DuoRealListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testStationaryDuplicateAdvancementRendersRealSourceOutput() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let configuration = try JSONDecoder().decode(
      Configuration.self, from: Data(contentsOf: documents.appendingPathComponent("arcadia-jellyfin-fixture.json")))
    let directory = documents.appendingPathComponent("duo-stationary-59")
    if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { UIPasteboard.general.string = nil }
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    try connect(configuration, app: app)
    let play = app.buttons["track.\(configuration.secondSongID).play"]
    let actions = app.buttons["track.\(configuration.secondSongID).actions"]
    let songs = app.scrollViews["songs.scroll"]
    for _ in 0..<12 {
      if play.exists && play.isHittable && songs.frame.contains(play.frame) { break }
      songs.swipeUp()
    }
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    try Data().write(to: directory.appendingPathComponent("target-request"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("capture-ready"), timeout: 30))
    app.buttons["player.pause"].tap()
    actions.tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.expand"].tap()
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    app.buttons["queue.toggle"].tap()
    let queue = app.scrollViews.matching(identifier: "queue.scroll").allElementsBoundByIndex.filter(\.isHittable)
    XCTAssertEqual(queue.count, 1)
    guard let visible = queue.first else { return }
    let current = visible.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.current."))
    let upcoming = visible.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
    XCTAssertEqual(current.count, 1)
    XCTAssertEqual(upcoming.count, 1)
    let first = current.element.identifier
    let second = upcoming.element.identifier.replacingOccurrences(of: "queue.entry.", with: "queue.current.")
    nativeBack(app)
    app.buttons["player.resume"].tap()
    XCTAssertTrue(waitForPlaying(app))
    let before = Date().timeIntervalSince1970
    Thread.sleep(forTimeInterval: 3)
    let beforeEnd = Date().timeIntervalSince1970
    app.buttons["queue.toggle"].tap()
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [
          XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.staticTexts[first])
        ],
        timeout: 20), .completed)
    XCTAssertTrue(app.staticTexts[second].waitForExistence(timeout: 5))
    nativeBack(app)
    XCTAssertTrue(waitForPlaying(app))
    let after = Date().timeIntervalSince1970
    Thread.sleep(forTimeInterval: 3)
    let phases: [[String: Any]] = [
      ["name": "before-natural", "start": before, "end": beforeEnd],
      ["name": "after-natural", "start": after, "end": Date().timeIntervalSince1970],
    ]
    try JSONSerialization.data(withJSONObject: phases).write(to: directory.appendingPathComponent("phases.json"))
    app.buttons["player.pause"].tap()
    try Data().write(to: directory.appendingPathComponent("done"))
    app.buttons["player.dismiss"].tap()
    app.buttons["source.disconnect"].tap()
  }

  @MainActor
  func testFirstClosedFoldRendersRealSourceBeforeNaturalBoundary() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let configuration = try JSONDecoder().decode(
      Configuration.self, from: Data(contentsOf: documents.appendingPathComponent("arcadia-jellyfin-fixture.json")))
    let directory = documents.appendingPathComponent("duo-first-fold-59")
    if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { UIPasteboard.general.string = nil }
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    try connect(configuration, app: app)
    let play = app.buttons["track.\(configuration.secondSongID).play"]
    let actions = app.buttons["track.\(configuration.secondSongID).actions"]
    let songs = app.scrollViews["songs.scroll"]
    for _ in 0..<12 {
      if play.exists && play.isHittable && songs.frame.contains(play.frame) { break }
      songs.swipeUp()
    }
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    try Data().write(to: directory.appendingPathComponent("target-request"))
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("capture-ready"), timeout: 30))
    app.buttons["player.pause"].tap()
    actions.tap()
    app.buttons["Add to Queue"].tap()
    app.buttons["player.expand"].tap()
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    app.buttons["player.resume"].tap()
    XCTAssertTrue(waitForPlaying(app))
    try Data("closed".utf8).write(to: directory.appendingPathComponent("request"), options: .atomic)
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("closed.complete"), timeout: 30))
    try Data("open".utf8).write(to: directory.appendingPathComponent("request"), options: .atomic)
    XCTAssertTrue(waitForFile(directory.appendingPathComponent("open.complete"), timeout: 30))
    XCTAssertEqual(app.state, .runningForeground)
    XCTAssertTrue(waitForPlaying(app))
    app.buttons["player.pause"].tap()
    try Data().write(to: directory.appendingPathComponent("done"))
    app.buttons["player.dismiss"].tap()
    app.terminate()
  }

  @MainActor
  private func nativeBack(_ app: XCUIApplication) {
    let back = app.buttons.matching(identifier: "BackButton").allElementsBoundByIndex.filter(\.isHittable)
    XCTAssertEqual(back.count, 1)
    back.first?.tap()
  }

  @MainActor
  func testRealOutputContinuesDuringNativeFoldsAndDuplicateAdvancement() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let configuration = try JSONDecoder().decode(
      Configuration.self, from: Data(contentsOf: documents.appendingPathComponent("arcadia-jellyfin-fixture.json")))
    let protocolDirectory = documents.appendingPathComponent("duo-real-59")
    if FileManager.default.fileExists(atPath: protocolDirectory.path) {
      try FileManager.default.removeItem(at: protocolDirectory)
    }
    try FileManager.default.createDirectory(at: protocolDirectory, withIntermediateDirectories: true)
    defer { UIPasteboard.general.string = nil }
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "jellyfin"
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    try connect(configuration, app: app)
    let actions = app.buttons["track.\(configuration.secondSongID).actions"]
    let songs = app.scrollViews["songs.scroll"]
    for _ in 0..<12 {
      if actions.exists && actions.isHittable && songs.frame.contains(actions.frame) { break }
      songs.swipeUp()
    }
    XCTAssertTrue(actions.isHittable)
    app.buttons["track.\(configuration.secondSongID).play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    try Data().write(to: protocolDirectory.appendingPathComponent("target-request"))
    XCTAssertTrue(waitForFile(protocolDirectory.appendingPathComponent("capture-ready"), timeout: 30))
    app.buttons["player.pause"].tap()
    // Thirteen occurrences of the controlled 12-second, 600Hz source sustain the
    // native fold journey. Natural advancement is expected, not a session reset.
    for _ in 0..<12 {
      actions.tap()
      app.buttons["Add to Queue"].tap()
    }
    app.buttons["player.expand"].tap()
    let expanded = app.otherElements["player.expanded"]
    XCTAssertTrue(expanded.waitForExistence(timeout: 5))
    XCTAssertEqual(expanded.staticTexts["player.title"].label, "Persistent State")
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    app.buttons["player.resume"].tap()
    XCTAssertTrue(waitForPlaying(app))
    for phase in ["closed", "partial", "rotated", "open"] {
      try Data(phase.utf8).write(to: protocolDirectory.appendingPathComponent("request"), options: .atomic)
      XCTAssertTrue(waitForFile(protocolDirectory.appendingPathComponent("\(phase).complete"), timeout: 90))
      XCTAssertEqual(app.state, .runningForeground)
      XCTAssertEqual(expanded.staticTexts["player.title"].label, "Persistent State")
      XCTAssertTrue(waitForPlaying(app))
      let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
      screenshot.name = "Real Jellyfin 600Hz - committed native \(phase)"
      screenshot.lifetime = .keepAlways
      add(screenshot)
      app.buttons["queue.toggle"].tap()
      let visible = app.scrollViews.matching(identifier: "queue.scroll").allElementsBoundByIndex.filter(\.isHittable)
      XCTAssertEqual(visible.count, 1)
      if let queue = visible.first {
        let snapshot = XCTAttachment(string: queue.debugDescription)
        snapshot.name = "Real native \(phase) - current and upcoming occurrence ordering"
        snapshot.lifetime = .keepAlways
        add(snapshot)
      }
      let back = app.buttons.matching(identifier: "BackButton").allElementsBoundByIndex.filter(\.isHittable)
      XCTAssertEqual(back.count, 1)
      back.first?.tap()
    }
    app.buttons["player.pause"].tap()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    try Data().write(to: protocolDirectory.appendingPathComponent("done"))
    app.buttons["player.dismiss"].tap()
    app.buttons["source.disconnect"].tap()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
  }

  @MainActor
  private func connect(_ configuration: Configuration, app: XCUIApplication) throws {
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].tap()
    app.textFields["source.server"].typeText(configuration.server)
    app.textFields["source.username"].tap()
    app.textFields["source.username"].typeText(configuration.username)
    UIPasteboard.general.string = configuration.password
    let password = app.secureTextFields["source.password"]
    password.tap()
    password.press(forDuration: 1.2)
    if app.menuItems["Paste"].waitForExistence(timeout: 3) {
      app.menuItems["Paste"].tap()
    } else {
      app.buttons["Paste"].tap()
    }
    app.buttons["source.connect"].tap()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    let system = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
    if system.buttons["Not Now"].waitForExistence(timeout: 3) {
      system.buttons["Not Now"].tap()
    }
  }

  @MainActor
  private func waitForPlaying(_ app: XCUIApplication) -> Bool {
    let state = app.staticTexts["player.state"]
    return XCTWaiter.wait(
      for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Playing"), object: state)],
      timeout: 10) == .completed
  }

  private func waitForFile(_ file: URL, timeout: TimeInterval) -> Bool {
    XCTWaiter.wait(
      for: [
        XCTNSPredicateExpectation(
          predicate: NSPredicate { _, _ in FileManager.default.fileExists(atPath: file.path) }, object: nil)
      ], timeout: timeout) == .completed
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
    let secondSongID: String
  }
}
