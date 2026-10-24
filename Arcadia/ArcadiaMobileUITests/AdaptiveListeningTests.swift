import XCTest

final class AdaptiveListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  private func requireNativeController() throws {
    let marker = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("arcadia-duo-native-validation.json")
    guard FileManager.default.fileExists(atPath: marker.path) else {
      throw XCTSkip("Requires the explicit native Duo fold/orientation controller")
    }
    let configuration = try JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? [String: String]
    XCTAssertEqual(configuration?["controller"], "duo-native")
  }

  @MainActor
  func testClosedLandscapeKeepsTransportInsideActualShortWindow() throws {
    try requireNativeController()
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.buttons["track.fixture-1-track-1.play"].waitForExistence(timeout: 10))
    app.buttons["track.fixture-1-track-1.play"].tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("duo-short-59")
    if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data().write(to: directory.appendingPathComponent("request"))
    let committed = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        FileManager.default.fileExists(atPath: directory.appendingPathComponent("complete").path)
      },
      object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [committed], timeout: 60), .completed)
    let expanded = app.otherElements["player.expanded"]
    let window = app.windows.firstMatch.frame
    let resume = expanded.buttons["player.resume"]
    let seek = expanded.sliders["player.seek"]
    capture(app, "Actual closed Duo landscape - short-height transport and seek")
    let bounds = XCTAttachment(string: "window=\(window); resume=\(resume.frame); seek=\(seek.frame)")
    bounds.name = "Actual short-height public control bounds"
    bounds.lifetime = .keepAlways
    add(bounds)
    XCTAssertLessThan(window.height, 500, "Native closed landscape must actually produce a short window")
    XCTAssertGreaterThan(window.width, window.height)
    XCTAssertTrue(resume.isHittable && seek.isHittable)
    XCTAssertTrue(window.contains(resume.frame) && window.contains(seek.frame))
  }

  @MainActor
  func testNativeFoldsPreserveListeningQueueAndArtistRoute() throws {
    try requireNativeController()
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.segmentedControls.buttons["Artists"].waitForExistence(timeout: 10))
    app.segmentedControls.buttons["Artists"].tap()
    app.buttons["artist.fixture-artist-1"].tap()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    for _ in 0..<2 {
      app.buttons["track.fixture-1-track-2.actions"].tap()
      app.buttons["Add to Queue"].tap()
    }
    app.buttons["player.expand"].tap()
    let expanded = app.otherElements["player.expanded"]
    XCTAssertTrue(expanded.waitForExistence(timeout: 5))
    let title = expanded.staticTexts["player.title"].label
    let elapsed = expanded.staticTexts["player.elapsed"].label
    let originalQueue = inspectQueue(app)
    XCTAssertEqual(originalQueue.count, 3, "Current occurrence and two distinct duplicate upcoming entries")
    XCTAssertEqual(Set(originalQueue).count, 3)

    let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("duo-fold-59")
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    for phase in ["closed", "partial", "rotated", "open"] {
      try Data(phase.utf8).write(to: directory.appendingPathComponent("request"), options: .atomic)
      let complete = directory.appendingPathComponent("\(phase).complete")
      let committed = XCTNSPredicateExpectation(
        predicate: NSPredicate { _, _ in FileManager.default.fileExists(atPath: complete.path) }, object: nil
      )
      XCTAssertEqual(XCTWaiter.wait(for: [committed], timeout: 90), .completed)
      XCTAssertEqual(app.state, .runningForeground)
      XCTAssertTrue(expanded.buttons["player.resume"].isHittable)
      XCTAssertEqual(expanded.staticTexts["player.title"].label, title)
      XCTAssertEqual(expanded.staticTexts["player.elapsed"].label, elapsed)
      let bounds = XCTAttachment(
        string:
          "window=\(app.windows.firstMatch.frame); transport=\(expanded.buttons["player.resume"].frame); seek=\(expanded.sliders["player.seek"].frame)"
      )
      bounds.name = "Committed native \(phase) - actual public control bounds"
      bounds.lifetime = .keepAlways
      add(bounds)
      XCTAssertTrue(app.windows.firstMatch.frame.contains(expanded.buttons["player.resume"].frame))
      XCTAssertTrue(app.windows.firstMatch.frame.contains(expanded.sliders["player.seek"].frame))
      capture(app, "Committed native Duo \(phase) - retained paused song and controls")
      assertPlayerControlsAvoidNativeRail(app, expanded: expanded, phase: phase)
      XCTAssertEqual(inspectQueue(app), originalQueue)
    }
    app.buttons["player.dismiss"].tap()
    XCTAssertTrue(app.staticTexts["artist.songs.title"].waitForExistence(timeout: 5))
    try Data("done".utf8).write(to: directory.appendingPathComponent("done"), options: .atomic)
  }

  @MainActor
  private func assertPlayerControlsAvoidNativeRail(
    _ app: XCUIApplication, expanded: XCUIElement, phase: String
  ) {
    let controls = [
      expanded.staticTexts["player.title"], expanded.sliders["player.seek"],
      expanded.buttons["player.previous"], expanded.buttons["player.resume"],
      expanded.buttons["player.next"],
    ]
    let nativeRail = [app.buttons["queue.toggle"], app.buttons["player.dismiss"]]
    let bounds = XCTAttachment(
      string: (controls + nativeRail).map { "\($0.identifier)=\($0.frame)" }.joined(separator: "\n"))
    bounds.name = "Committed native \(phase) - player and native rail nonintersection bounds"
    bounds.lifetime = .keepAlways
    add(bounds)
    for control in controls {
      XCTAssertTrue(control.exists && control.isHittable, "\(phase): \(control.identifier) is reachable")
      XCTAssertTrue(app.windows.firstMatch.frame.contains(control.frame))
      for nativeButton in nativeRail {
        XCTAssertTrue(nativeButton.exists && nativeButton.isHittable)
        XCTAssertFalse(
          control.frame.intersects(nativeButton.frame),
          "\(phase): \(control.identifier) must not lie under \(nativeButton.identifier)")
      }
    }
  }

  @MainActor
  private func inspectQueue(_ app: XCUIApplication) -> [String] {
    app.buttons["queue.toggle"].tap()
    let visible = app.scrollViews.matching(identifier: "queue.scroll").allElementsBoundByIndex.filter(\.isHittable)
    XCTAssertEqual(visible.count, 1, "Inspect the dedicated visible Queue, not retained hidden content")
    guard let queue = visible.first else { return [] }
    let current = queue.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.current."))
      .allElementsBoundByIndex.map(\.identifier)
    let upcoming = queue.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "queue.entry."))
      .allElementsBoundByIndex.map(\.identifier)
    let back = app.buttons.matching(identifier: "BackButton").allElementsBoundByIndex.filter(\.isHittable)
    XCTAssertEqual(back.count, 1, "Use the observed native Duo Back control")
    back.first?.tap()
    return current + upcoming
  }

  @MainActor
  func testExpandedDuoShowsQueueAlongsidePlayer() throws {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    let expanded = app.otherElements["player.expanded"]
    XCTAssertTrue(expanded.waitForExistence(timeout: 5))
    // Run only after the native driver commits an expanded display arrangement.
    // A compact destination cannot establish this adaptive composition contract.
    try XCTSkipIf(app.windows.firstMatch.frame.width < 650, "Requires committed expanded Duo display")
    capture(app, "Expanded Duo baseline - player and queue composition")
    XCTAssertTrue(app.staticTexts["queue.heading"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["queue.heading"].isHittable)
    XCTAssertTrue(expanded.buttons["player.resume"].isHittable)
    XCTAssertTrue(app.windows.firstMatch.frame.contains(app.staticTexts["queue.heading"].frame))
  }

  @MainActor
  func testRotationKeepsTransportReachableAndListeningSelection() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    XCUIDevice.shared.orientation = .portrait
    defer { XCUIDevice.shared.orientation = .portrait }
    app.launch()
    let play = app.buttons["track.fixture-1-track-1.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.tap()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.buttons["player.pause"].tap()
    app.buttons["player.expand"].tap()
    XCTAssertTrue(app.buttons["player.dismiss"].waitForExistence(timeout: 5))
    let expanded = app.otherElements["player.expanded"]
    XCTAssertTrue(expanded.waitForExistence(timeout: 5))
    let title = expanded.staticTexts["player.title"].label
    XCUIDevice.shared.orientation = .landscapeRight
    let resume = expanded.buttons["player.resume"]
    let seek = expanded.sliders["player.seek"]
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    XCTAssertTrue(resume.isHittable)
    XCTAssertTrue(seek.isHittable)
    XCTAssertTrue(app.windows.firstMatch.frame.contains(resume.frame))
    XCTAssertTrue(app.windows.firstMatch.frame.contains(seek.frame))
    XCTAssertEqual(expanded.staticTexts["player.title"].label, title)
    capture(app, "Short height player - transport and seek visible without scrolling")
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(expanded.buttons["player.resume"].isHittable)
    XCTAssertEqual(expanded.staticTexts["player.title"].label, title)
    app.buttons["player.dismiss"].tap()
    XCTAssertTrue(app.staticTexts["songs.count"].exists)
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
  }

  @MainActor
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
