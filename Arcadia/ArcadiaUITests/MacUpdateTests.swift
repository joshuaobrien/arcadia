import AppKit
import XCTest

/// Explicit installed-Release acceptance tests. The harness owns the app, update feed and Jellyfin fixture.
final class MacUpdateTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testInstalledReleaseConnectsToJellyfin() throws {
    let config = try configuration()
    let app = try installedApp(config, build: config.beforeBuild)
    XCTAssertTrue(app.textFields["source.server"].waitForExistence(timeout: 10))
    app.textFields["source.server"].click()
    app.textFields["source.server"].typeText(config.server)
    app.textFields["source.username"].click()
    app.textFields["source.username"].typeText(config.username)
    app.secureTextFields["source.password"].click()
    defer { NSPasteboard.general.clearContents() }
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(config.password, forType: .string))
    app.secureTextFields["source.password"].typeKey("v", modifierFlags: .command)
    app.buttons["source.connect"].click()
    XCTAssertTrue(app.buttons["source.disconnect"].waitForExistence(timeout: 20))
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    attach(app, name: "Installed Release before update - build " + config.beforeBuild)
  }

  @MainActor
  // Private signing requires the listener's normal Keychain approval before this check.
  // That approval is distinct from entering Jellyfin credentials again.
  func testUpdatedReleaseRestoresJellyfinAfterKeychainApproval() throws {
    let config = try configuration()
    let app = try installedApp(config, build: config.afterBuild)
    XCTAssertTrue(app.buttons["source.disconnect"].waitForExistence(timeout: 20))
    XCTAssertFalse(app.textFields["source.server"].exists)
    XCTAssertTrue(app.staticTexts["songs.count"].waitForExistence(timeout: 20))
    attach(app, name: "Installed Release after update - build " + config.afterBuild)
  }

  @MainActor
  private func installedApp(_ config: Configuration, build: String) throws -> XCUIApplication {
    let running = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier: "tokyo.drift.Arcadia").first)
    let url = try XCTUnwrap(running.bundleURL)
    XCTAssertEqual(url.path, config.installedApp)
    let bundle = try XCTUnwrap(Bundle(url: url))
    XCTAssertEqual(bundle.infoDictionary?["CFBundleVersion"] as? String, build)
    let app = XCUIApplication(bundleIdentifier: "tokyo.drift.Arcadia")
    app.activate()
    return app
  }

  @MainActor
  private func attach(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func configuration() throws -> Configuration {
    let url = URL(fileURLWithPath: "/tmp/arcadia-macos-update-test.json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw XCTSkip("Requires the explicit installed Release and disposable Jellyfin update harness.")
    }
    return try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: url))
  }

  private struct Configuration: Decodable {
    let server: String
    let username: String
    let password: String
    let installedApp: String
    let beforeBuild: String
    let afterBuild: String
  }
}
