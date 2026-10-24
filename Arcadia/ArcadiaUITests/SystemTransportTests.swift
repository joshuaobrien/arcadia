import XCTest

final class SystemTransportTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testKeyboardCommandsControlTheSharedListeningSession() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["library.destination.albums"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.albums"].click()
    let album = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "album.")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    album.click()
    let play = app.buttons["album.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    app.typeKey("p", modifierFlags: [.command, .option])
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    app.typeKey("p", modifierFlags: [.command, .option])
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 5))
    let title = app.staticTexts["player.title"].value as? String
    app.typeKey(.rightArrow, modifierFlags: [.command, .option])
    expectation(for: NSPredicate(format: "value != %@", title ?? ""), evaluatedWith: app.staticTexts["player.title"])
    waitForExpectations(timeout: 5)
    app.typeKey("p", modifierFlags: [.command, .option])
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0)
    expectation(for: NSPredicate(format: "value == %@", "0:00"), evaluatedWith: app.staticTexts["player.elapsed"])
    waitForExpectations(timeout: 5)
    app.typeKey(.leftArrow, modifierFlags: [.command, .option])
    expectation(for: NSPredicate(format: "value == %@", title ?? ""), evaluatedWith: app.staticTexts["player.title"])
    waitForExpectations(timeout: 5)
    XCTAssertTrue(app.buttons["player.resume"].exists)
    XCTAssertTrue(app.buttons["player.previous"].isEnabled)
  }

  @MainActor
  func testNativeNowPlayingRoutesToTheSharedSession() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment["ARCADIA_DATA_MODE"] = "fixtures"
    app.launchEnvironment["ARCADIA_FIXTURE_SCENARIO"] = "success"
    app.launchEnvironment["ARCADIA_LIBRARY_NAMESPACE"] = UUID().uuidString
    app.launch()
    XCTAssertTrue(app.staticTexts["library.destination.albums"].waitForExistence(timeout: 10))
    app.staticTexts["library.destination.albums"].click()
    let album = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "album.")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 10))
    album.click()
    let play = app.buttons["album.play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10))
    play.click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 10))
    let title = try XCTUnwrap(app.staticTexts["player.title"].value as? String)
    let controls = XCUIApplication(bundleIdentifier: "com.apple.controlcenter")
    controls.descendants(matching: .any)["com.apple.menuextra.controlcenter"].click()
    print(controls.debugDescription)
    XCTAssertTrue(
      controls.staticTexts.matching(NSPredicate(format: "value BEGINSWITH %@", title)).firstMatch.waitForExistence(
        timeout: 5))
    controls.buttons["pause.fill"].click()
    XCTAssertTrue(app.buttons["player.resume"].waitForExistence(timeout: 5))
    XCTAssertTrue(controls.buttons["play.fill"].waitForExistence(timeout: 5))
    controls.buttons["play.fill"].click()
    XCTAssertTrue(app.buttons["player.pause"].waitForExistence(timeout: 5))
    controls.buttons["forward.fill"].click()
    expectation(for: NSPredicate(format: "value != %@", title), evaluatedWith: app.staticTexts["player.title"])
    waitForExpectations(timeout: 5)
    let next = try XCTUnwrap(app.staticTexts["player.title"].value as? String)
    XCTAssertTrue(
      controls.staticTexts.matching(NSPredicate(format: "value BEGINSWITH %@", next)).firstMatch.waitForExistence(
        timeout: 5))
    let screenshot = XCTAttachment(screenshot: controls.dialogs.firstMatch.screenshot())
    screenshot.name = "native-system-controls-follow-shared-session"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    controls.buttons["pause.fill"].click()
    controls.descendants(matching: .any)["com.apple.menuextra.controlcenter"].click()
  }
}
