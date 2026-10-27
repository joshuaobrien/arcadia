import AppKit
import XCTest

final class IssueReportTests: XCTestCase {
  @MainActor func testScreenshotReportRequiresTitleAndTokenAndCanBeCancelled() {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launchEnvironment["ARCADIA_SESSION_NAMESPACE"] = UUID().uuidString
    app.launch()
    let report = app.buttons["issue.report"]
    XCTAssertTrue(report.waitForExistence(timeout: 15))
    report.click()
    let title = app.textFields["issue.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertTrue(app.images["issue.screenshot"].exists)
    XCTAssertFalse(app.buttons["issue.submit"].isEnabled)
    title.click()
    title.typeText("Artwork is missing")
    XCTAssertFalse(app.buttons["issue.submit"].isEnabled)
    let sheet = app.sheets.firstMatch
    XCTAssertTrue(sheet.exists)
    let attachment = XCTAttachment(screenshot: sheet.screenshot())
    attachment.name = "Report form with app screenshot"
    attachment.lifetime = .keepAlways
    add(attachment)
    sheet.scrollViews.firstMatch.swipeUp()
    let screenshot = app.images["issue.screenshot"]
    assertScreenshotContainsLibraryArtwork(screenshot)
    screenshot.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.15)).press(
      forDuration: 0.1,
      thenDragTo: screenshot.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.75)))
    XCTAssertTrue(app.buttons["Use full screenshot"].isEnabled)
    let preview = XCTAttachment(screenshot: sheet.screenshot())
    preview.name = "Report screenshot selection and Gitea credentials"
    preview.lifetime = .keepAlways
    add(preview)
    app.buttons["Use full screenshot"].click()
    XCTAssertFalse(app.buttons["Use full screenshot"].isEnabled)
    app.buttons["Cancel"].click()
    XCTAssertFalse(title.exists)
    XCTAssertTrue(report.exists)
  }

  @MainActor private func assertScreenshotContainsLibraryArtwork(_ preview: XCUIElement) {
    guard let data = preview.screenshot().image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data)
    else {
      XCTFail("Could not inspect the screenshot preview")
      return
    }
    var coloredPixels = 0
    for row in stride(from: 4, to: bitmap.pixelsHigh - 4, by: 3) {
      for column in stride(from: 4, to: bitmap.pixelsWide - 4, by: 3) {
        guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB) else { continue }
        if abs(color.redComponent - color.blueComponent) > 0.08
          || abs(color.greenComponent - color.blueComponent) > 0.08
        {
          coloredPixels += 1
        }
      }
    }
    XCTAssertGreaterThan(coloredPixels, 20, "The fixture library's colored artwork must appear in the screenshot")
  }
}
