import CoreGraphics
import Foundation
import XCTest

@testable import Arcadia

final class IssueReporterTests: XCTestCase {
  @MainActor func testCropUsesSelectedPixelRegion() throws {
    let context = try XCTUnwrap(
      CGContext(
        data: nil, width: 100, height: 80, bitsPerComponent: 8,
        bytesPerRow: 400, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 100, height: 80))
    let screenshot = IssueScreenshot(image: try XCTUnwrap(context.makeImage()))
    let cropped = try XCTUnwrap(screenshot.cropped(to: CGRect(x: 0.2, y: 0.25, width: 0.5, height: 0.5)))
    XCTAssertEqual(cropped.image.width, 50)
    XCTAssertEqual(cropped.image.height, 40)
    XCTAssertGreaterThan(try XCTUnwrap(cropped.png).count, 20)
  }

  @MainActor func testCreatesUploadsThenLabelsExistingIssue() async throws {
    var requests: [URLRequest] = []
    var reporter = IssueReporter(token: "disposable-test-token")
    reporter.send = { request in
      requests.append(request)
      let url = try XCTUnwrap(request.url)
      let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 201, httpVersion: nil, headerFields: nil))
      let body: String
      switch requests.count {
      case 1: body = "[{\"id\":12,\"name\":\"agent\"}]"
      case 2: body = "{\"number\":73,\"html_url\":\"https://example.test/jj/arcadia/issues/73\"}"
      case 3: body = "{\"browser_download_url\":\"https://example.test/attachments/screenshot.png\"}"
      default: body = "{}"
      }
      return (Data(body.utf8), response)
    }
    let label = try await reporter.agentLabel()
    let issue = try await reporter.create(title: "Missing artwork", body: "Steps to reproduce")
    let png = Data([137, 80, 78, 71])
    let attachmentURL = try await reporter.attach(png, to: issue)
    try await reporter.updateBody("Steps to reproduce\n\n![App screenshot](\(attachmentURL.absoluteString))", of: issue)
    try await reporter.assignAgent(label, to: issue)
    XCTAssertEqual(
      requests.map { $0.url?.path },
      [
        "/api/v1/repos/jj/arcadia/labels", "/api/v1/repos/jj/arcadia/issues",
        "/api/v1/repos/jj/arcadia/issues/73/assets", "/api/v1/repos/jj/arcadia/issues/73",
        "/api/v1/repos/jj/arcadia/issues/73/labels",
      ])
    XCTAssertEqual(requests.map(\.httpMethod), ["GET", "POST", "POST", "PATCH", "POST"])
    XCTAssertTrue(
      requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "token disposable-test-token" })
    let create = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(requests[1].httpBody)) as? [String: Any])
    XCTAssertEqual(create["title"] as? String, "Missing artwork")
    XCTAssertEqual(create["body"] as? String, "Steps to reproduce")
    XCTAssertNil(create["labels"])
    XCTAssertNotNil(requests[2].httpBody?.range(of: png))
    let labels = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(requests[4].httpBody)) as? [String: [Int]])
    XCTAssertEqual(labels["labels"], [12])
  }

  @MainActor func testMissingAgentLabelStopsBeforeCreation() async throws {
    var reporter = IssueReporter(token: "test")
    reporter.send = { request in
      let response = try XCTUnwrap(
        HTTPURLResponse(
          url: XCTUnwrap(request.url), statusCode: 200,
          httpVersion: nil, headerFields: nil))
      return (Data("[]".utf8), response)
    }
    do {
      _ = try await reporter.agentLabel()
      XCTFail("Missing agent label must prevent creation")
    } catch IssueReporter.Failure.missingLabel {}
  }

  @MainActor func testUnauthorizedResponseIsAnActionableFailure() async throws {
    var reporter = IssueReporter(token: "invalid")
    reporter.send = { request in
      let response = try XCTUnwrap(
        HTTPURLResponse(
          url: XCTUnwrap(request.url), statusCode: 401,
          httpVersion: nil, headerFields: nil))
      return (Data(), response)
    }
    do {
      _ = try await reporter.create(title: "Title", body: "Body")
      XCTFail("Unauthorized requests must not succeed")
    } catch IssueReporter.Failure.request(let status) {
      XCTAssertEqual(status, 401)
    }
  }
}
