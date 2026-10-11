import Foundation

// Use an ephemeral, non-redirecting session: credentials never follow a redirect to another origin.
private final class SourceRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _: URLSession, task _: URLSessionTask, willPerformHTTPRedirection _: HTTPURLResponse,
    newRequest _: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

struct JellyfinRequest {
  let server: URL
  let deviceID: String
  let token: String?

  func url(path: [String], query: [URLQueryItem] = []) -> URL {
    path.reduce(server) { $0.appendingPathComponent($1) }.appending(queryItems: query)
  }

  func data(path: [String], query: [URLQueryItem] = [], body: Data? = nil) async throws -> Data {
    try await data(url: url(path: path, query: query), body: body)
  }

  func data(url: URL, body: Data? = nil) async throws -> Data {
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    var authorization = "MediaBrowser Client=\"Arcadia\", Device=\"Native\", DeviceId=\"\(deviceID)\", Version=\"1\""
    if let token { authorization += ", Token=\"\(token)\"" }
    request.setValue(authorization, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let session = URLSession(configuration: .ephemeral, delegate: SourceRedirectPolicy(), delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    AppDiagnostics.event(Task.isCancelled ? "source.request.cancelled-task" : "source.request")
    do {
      let (data, response) = try await session.data(for: request)
      guard let response = response as? HTTPURLResponse else { throw MusicSourceError.invalidResponse }
      switch response.statusCode {
      case 200..<300: return data
      case 401, 403: throw MusicSourceError.authenticationFailed
      default:
        AppDiagnostics.event("source.http.failure.\(response.statusCode)")
        throw MusicSourceError.unavailable
      }
    } catch let error as MusicSourceError {
      AppDiagnostics.event("source.request.failed")
      throw error
    } catch {
      if Task.isCancelled { AppDiagnostics.event("source.transport.cancelled-task") }
      if let failure = error as? URLError {
        AppDiagnostics.event("source.transport.failure.\(failure.errorCode)")
      } else {
        AppDiagnostics.event("source.transport.failed")
      }
      throw MusicSourceError.unavailable
    }
  }
}
