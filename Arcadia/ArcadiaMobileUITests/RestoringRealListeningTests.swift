import UIKit
import XCTest

final class RestoringRealListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testRealJellyfinRestoresTheSameQueueAndPositionPausedAfterRestart() throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let fixture = documents.appendingPathComponent("arcadia-jellyfin-fixture.json")
    try XCTSkipUnless(
      waitForFile(fixture, timeout: 15),
      "Requires the explicit real-source iPhone driver and private fixture configuration.")
    let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: fixture))
    let audio = documents.appendingPathComponent("mobile-restore-58")
    if FileManager.default.fileExists(atPath: audio.path) { try FileManager.default.removeItem(at: audio) }
    try FileManager.default.createDirectory(at: audio, withIntermediateDirectories: true)
    let app = connect(configuration)
    trackControl(configuration.firstSongID, action: "play", app: app).tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 15))
    app.buttons["player.expand"].tap()
    XCTAssertTrue(waitForState("Playing", app: app))
    app.buttons["player.pause"].tap()
    app.buttons["player.dismiss"].tap()
    addUpcoming(configuration.secondSongID, action: "Play Next", app: app)
    addUpcoming(configuration.firstSongID, action: "Add to Queue", app: app)
    app.buttons["player.expand"].tap()
    app.buttons["queue.toggle"].tap()
    let originalQueue = queueIdentity(app)
    XCTAssertEqual(originalQueue.count, 3)
    try JSONSerialization.data(withJSONObject: originalQueue).write(
      to: audio.appendingPathComponent("queue-before.json"))
    app.navigationBars.buttons["Now Playing"].tap()
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.6)
    XCTAssertTrue(waitForElapsed(seconds: 17...20, app: app))
    try Data().write(to: audio.appendingPathComponent("target-request"))
    XCTAssertTrue(waitForFile(audio.appendingPathComponent("capture-ready"), timeout: 30))
    app.buttons["player.resume"].tap()
    XCTAssertTrue(waitForState("Playing", app: app))
    var phases: [[String: Any]] = []
    phase("before-restart", phases: &phases, directory: "mobile-restore-58")
    XCTAssertTrue(waitForState("Playing", app: app))
    let position = elapsedSeconds(app)
    XCTAssertTrue((18...26).contains(position))
    capture(app, "Real iPhone listening state before restart - playing queue and position")
    XCUIDevice.shared.press(.home)
    let background = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "state == %d", XCUIApplication.State.runningBackground.rawValue), object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [background], timeout: 5), .completed)
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 15))
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, "First Contact")
    app.buttons["player.expand"].tap()
    XCTAssertTrue(waitForState("Paused", app: app))
    XCTAssertTrue(waitForElapsed(seconds: (position - 1)...(position + 3), app: app))
    let artwork = NSPredicate { _, _ in
      let window = app.windows.firstMatch.frame
      return app.images.matching(identifier: "artwork.loaded").allElementsBoundByIndex.contains { image in
        let frame = image.frame
        return image.isHittable && frame.width >= 200 && frame.height >= 200
          && frame.intersection(window).width >= 200 && frame.intersection(window).height >= 200
      }
    }
    XCTAssertEqual(
      XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: artwork, object: app)], timeout: 10), .completed)
    capture(app, "Real iPhone restored paused artwork - loaded in the current large Now Playing view")
    app.buttons["queue.toggle"].tap()
    XCTAssertEqual(queueIdentity(app), originalQueue)
    capture(app, "Real iPhone restored queue - same occurrence identities and order")
    app.navigationBars.buttons["Now Playing"].tap()
    phase("restored-paused", phases: &phases, directory: "mobile-restore-58")
    capture(app, "Real iPhone restoration remains paused at saved position")
    app.buttons["player.resume"].tap()
    XCTAssertTrue(waitForState("Playing", app: app))
    phase("restored-resumed", phases: &phases, directory: "mobile-restore-58")
    try Data().write(to: audio.appendingPathComponent("done"))
    app.buttons["player.pause"].tap()
    app.buttons["player.dismiss"].tap()
    app.buttons["source.disconnect"].tap()
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
  }

  @MainActor
  private func connect(_ configuration: Configuration) -> XCUIApplication {
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
    UIPasteboard.general.string = nil
    app.buttons["source.connect"].tap()
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    XCTAssertEqual(app.buttons.matching(identifier: "source.disconnect").count, 1)
    let nativePrompt = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    nativePrompt.name = "Full-device native post-login prompt"
    nativePrompt.lifetime = .keepAlways
    add(nativePrompt)
    let passwordService = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
    let systemButtons = XCTAttachment(
      string: passwordService.buttons.allElementsBoundByIndex.map(\.label).joined(separator: "\n"))
    systemButtons.name = "Observed native post-login prompt buttons"
    systemButtons.lifetime = .keepAlways
    add(systemButtons)
    if passwordService.buttons["Not Now"].waitForExistence(timeout: 3) {
      passwordService.buttons["Not Now"].tap()
    }
    app.activate()
    app.staticTexts["songs.count"].tap()
    return app
  }

  @MainActor
  private func queueIdentity(_ app: XCUIApplication) -> [String] {
    let current = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.current.")).firstMatch
      .identifier
    let upcoming = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry.")
    ).allElementsBoundByIndex.map(\.identifier)
    return [current] + upcoming
  }

  @MainActor
  private func elapsedSeconds(_ app: XCUIApplication) -> Int {
    let parts = app.staticTexts["player.elapsed"].label.split(separator: ":").compactMap { Int($0) }
    return parts.count == 2 ? parts[0] * 60 + parts[1] : -1
  }

  @MainActor
  private func trackControl(_ id: String, action: String, app: XCUIApplication) -> XCUIElement {
    let controls = app.buttons.matching(identifier: "track.\(id).\(action)")
    let scroll = app.scrollViews["songs.scroll"]
    XCTAssertTrue(scroll.waitForExistence(timeout: 10))
    let passwordService = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
    var trace: [String] = []
    var previous: [String] = []
    var chosen: XCUIElement?
    for step in 0..<9 {
      if passwordService.buttons["Not Now"].exists { passwordService.buttons["Not Now"].tap() }
      if app.buttons["Not Now"].exists { app.buttons["Not Now"].tap() }
      let viewport = scroll.frame.intersection(app.windows.firstMatch.frame)
      var bottom = viewport.maxY - 105
      let accessory = app.otherElements["player.bar"]
      if accessory.exists && accessory.frame.minY > viewport.minY {
        bottom = min(bottom, accessory.frame.minY - 8)
      }
      let safe = viewport.insetBy(dx: 0, dy: 10)
        .intersection(CGRect(x: 0, y: 0, width: viewport.maxX, height: bottom))
      let candidates = controls.allElementsBoundByIndex
      chosen = candidates.first { $0.isHittable && safe.contains($0.frame) }
      let visible = app.buttons.matching(
        NSPredicate(format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "track.", ".play")
      ).allElementsBoundByIndex.filter { $0.isHittable && safe.intersects($0.frame) }.map(\.identifier)
      trace.append("step=\(step) count=\(app.staticTexts["songs.count"].label) visible=\(visible)")
      trace.append(contentsOf: candidates.map { "target=\($0.identifier) frame=\($0.frame) hittable=\($0.isHittable)" })
      if chosen != nil { break }
      let more = app.buttons["songs.more"]
      if more.exists && more.isHittable {
        let oldCount = app.staticTexts["songs.count"].label
        more.tap()
        let changed = XCTNSPredicateExpectation(
          predicate: NSPredicate { _, _ in app.staticTexts["songs.count"].label != oldCount }, object: nil)
        if XCTWaiter.wait(for: [changed], timeout: 10) != .completed { break }
      } else {
        if step > 0 && visible == previous { break }
        previous = visible
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: viewport.midX, dy: safe.maxY - 20))
        let end = origin.withOffset(CGVector(dx: viewport.midX, dy: max(safe.minY + 60, safe.midY - 80)))
        start.press(forDuration: 0.1, thenDragTo: end)
      }
    }
    let route = XCTAttachment(string: trace.joined(separator: "\n"))
    route.name = "Exact controlled track route"
    route.lifetime = .keepAlways
    add(route)
    if chosen == nil {
      let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      screen.name = "Full-device unresolved track route"
      screen.lifetime = .keepAlways
      add(screen)
    }
    XCTAssertNotNil(chosen)
    return chosen ?? controls.firstMatch
  }

  @MainActor
  private func addUpcoming(_ id: String, action: String, app: XCUIApplication) {
    trackControl(id, action: "actions", app: app).tap()
    app.buttons[action].tap()
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

  private func phase(_ name: String, phases: inout [[String: Any]], directory: String = "mobile-audio-58") {
    let start = Date().timeIntervalSince1970
    Thread.sleep(forTimeInterval: 3)
    phases.append(["name": name, "start": start + 0.8, "end": Date().timeIntervalSince1970])
    let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("\(directory)/phases.json")
    try? JSONSerialization.data(withJSONObject: phases).write(to: file, options: .atomic)
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
