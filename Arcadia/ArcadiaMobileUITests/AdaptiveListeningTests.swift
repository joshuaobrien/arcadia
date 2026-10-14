import XCTest

final class AdaptiveListeningTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

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
    let title = app.staticTexts["player.title"].firstMatch.label
    XCUIDevice.shared.orientation = .landscapeRight
    let resume = app.buttons["player.resume"]
    let seek = app.sliders["player.seek"]
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    XCTAssertTrue(resume.isHittable)
    XCTAssertTrue(seek.isHittable)
    XCTAssertTrue(app.windows.firstMatch.frame.contains(resume.frame))
    XCTAssertTrue(app.windows.firstMatch.frame.contains(seek.frame))
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
    capture(app, "Short height player - transport and seek visible without scrolling")
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(app.buttons["player.resume"].isHittable)
    XCTAssertEqual(app.staticTexts["player.title"].firstMatch.label, title)
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
