import Foundation

struct IssueReporter {
  let token: String
  var send: (URLRequest) async throws -> (Data, URLResponse) = { try await URLSession.shared.data(for: $0) }
  private let repository = "https://joshs-mac-mini.tail81f644.ts.net/api/v1/repos/jj/arcadia"

  init(token: String) { self.token = token }

  struct CreatedIssue: Decodable {
    let number: Int
    let htmlUrl: URL
  }

  private struct Label: Decodable {
    let id: Int
    let name: String
  }

  private struct Attachment: Decodable {
    let browserDownloadUrl: URL
  }

  enum Failure: LocalizedError {
    case request(Int)
    case missingLabel
    case invalidResponse

    var errorDescription: String? {
      switch self {
      case .request(let status): "Gitea returned HTTP \(status). Check your connection and issue-write token."
      case .missingLabel: "The repository has no agent label. No issue was created."
      case .invalidResponse: "Gitea returned an unexpected response."
      }
    }
  }

  func agentLabel() async throws -> Int {
    let labelsData = try await request(path: "labels?limit=100")
    let labels = try JSONDecoder().decode([Label].self, from: labelsData)
    guard let label = labels.first(where: { $0.name == "agent" }) else { throw Failure.missingLabel }
    return label.id
  }

  func create(title: String, body: String) async throws -> CreatedIssue {
    let payload = try JSONSerialization.data(withJSONObject: ["title": title, "body": body])
    let data = try await request(path: "issues", method: "POST", data: payload)
    return try decoder().decode(CreatedIssue.self, from: data)
  }

  func attach(_ png: Data, to issue: CreatedIssue) async throws -> URL {
    let boundary = UUID().uuidString
    var data = Data(
      "--\(boundary)\r\nContent-Disposition: form-data; name=\"attachment\"; filename=\"screenshot.png\"\r\nContent-Type: image/png\r\n\r\n"
        .utf8)
    data.append(png)
    data.append(Data("\r\n--\(boundary)--\r\n".utf8))
    let response = try await request(
      path: "issues/\(issue.number)/assets", method: "POST", data: data,
      contentType: "multipart/form-data; boundary=\(boundary)")
    return try decoder().decode(Attachment.self, from: response).browserDownloadUrl
  }

  func updateBody(_ body: String, of issue: CreatedIssue) async throws {
    let data = try JSONSerialization.data(withJSONObject: ["body": body])
    _ = try await request(path: "issues/\(issue.number)", method: "PATCH", data: data)
  }

  func assignAgent(_ label: Int, to issue: CreatedIssue) async throws {
    let data = try JSONSerialization.data(withJSONObject: ["labels": [label]])
    _ = try await request(path: "issues/\(issue.number)/labels", method: "POST", data: data)
  }

  private func decoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return decoder
  }

  private func request(
    path: String, method: String = "GET", data: Data? = nil,
    contentType: String = "application/json"
  ) async throws -> Data {
    guard let url = URL(string: repository + "/" + path) else { throw Failure.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = data
    request.setValue("token " + token, forHTTPHeaderField: "Authorization")
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    let (responseData, response) = try await send(request)
    guard let response = response as? HTTPURLResponse else { throw Failure.invalidResponse }
    guard (200..<300).contains(response.statusCode) else { throw Failure.request(response.statusCode) }
    return responseData
  }
}
