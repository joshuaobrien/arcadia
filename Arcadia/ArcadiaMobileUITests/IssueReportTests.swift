import XCTest

final class IssueReportTests: XCTestCase {
  @MainActor func testScreenshotRegionSelectionCanBeReset() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launch()
    let report = app.buttons["issue.report"].firstMatch
    XCTAssertTrue(report.waitForExistence(timeout: 15))
    report.tap()
    let screenshot = app.images["issue.screenshot"]
    XCTAssertTrue(screenshot.waitForExistence(timeout: 5))
    let scroll = app.scrollViews.containing(.textField, identifier: "issue.title").firstMatch
    scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.8)).press(
      forDuration: 0.05, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.2)))
    screenshot.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).press(
      forDuration: 0.1, thenDragTo: screenshot.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.7)))
    XCTAssertTrue(app.buttons["Use full screenshot"].isEnabled)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Mobile screenshot region selection"
    attachment.lifetime = .keepAlways
    add(attachment)
    app.buttons["Use full screenshot"].tap()
    XCTAssertFalse(app.buttons["Use full screenshot"].isEnabled)
    for _ in 0..<3 {
      if app.buttons["Cancel"].exists { break }
      scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.2)).press(
        forDuration: 0.05, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.8)))
    }
    app.buttons["Cancel"].tap()
  }

  @MainActor func testScreenshotReportRequiresTitleAndTokenAndCanBeCancelled() {
    let app = XCUIApplication()
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launch()
    let report = app.buttons["issue.report"].firstMatch
    XCTAssertTrue(report.waitForExistence(timeout: 15))
    report.tap()
    let title = app.textFields["issue.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertTrue(app.images["issue.screenshot"].exists)
    XCTAssertFalse(app.buttons["issue.submit"].isEnabled)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Mobile report form with app screenshot"
    attachment.lifetime = .keepAlways
    add(attachment)
    title.tap()
    title.typeText("Artwork is missing")
    XCTAssertFalse(app.buttons["issue.submit"].isEnabled)
    app.buttons["Cancel"].tap()
    XCTAssertFalse(title.exists)
  }
}
