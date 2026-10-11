import Foundation

struct JellyfinConnector: MusicSourceConnector {
  func connect(server: URL, username: String, password: String) async throws -> ConnectedMusicSource {
    let deviceID = UUID().uuidString
    let request = JellyfinRequest(server: server, deviceID: deviceID, token: nil)
    let body = try JSONEncoder().encode(SignIn(username: username, password: password))
    let data = try await request.data(path: ["Users", "AuthenticateByName"], body: body)
    let authentication: Authentication
    do {
      authentication = try JSONDecoder().decode(Authentication.self, from: data)
    } catch {
      throw MusicSourceError.invalidResponse
    }
    guard !authentication.accessToken.isEmpty, !authentication.user.id.isEmpty else {
      throw MusicSourceError.invalidResponse
    }
    let session = JellyfinSession(
      server: server, userID: authentication.user.id, token: authentication.accessToken, deviceID: deviceID
    )
    return try connection(session)
  }

  func restore(_ session: Data) async throws -> ConnectedMusicSource {
    let saved = try JSONDecoder().decode(JellyfinSession.self, from: session)
    let request = JellyfinRequest(server: saved.server, deviceID: saved.deviceID, token: saved.token)
    _ = try await request.data(path: ["Users", saved.userID])
    return try connection(saved)
  }

  private func connection(_ session: JellyfinSession) throws -> ConnectedMusicSource {
    ConnectedMusicSource(source: JellyfinMusicSource(session: session), savedSession: try JSONEncoder().encode(session))
  }
}

private struct SignIn: Encodable {
  let username: String
  let password: String
  enum CodingKeys: String, CodingKey {
    case username = "Username"
    case password = "Pw"
  }
}

private struct Authentication: Decodable {
  let accessToken: String
  let user: AuthenticatedUser
  enum CodingKeys: String, CodingKey {
    case accessToken = "AccessToken"
    case user = "User"
  }
}

private struct AuthenticatedUser: Decodable {
  let id: String
  enum CodingKeys: String, CodingKey { case id = "Id" }
}

struct JellyfinSession: Codable, Sendable {
  let server: URL
  let userID: String
  let token: String
  let deviceID: String
}

final class JellyfinMusicSource: MusicSource {
  private let session: JellyfinSession
  private let request: JellyfinRequest

  init(session: JellyfinSession) {
    self.session = session
    request = JellyfinRequest(server: session.server, deviceID: session.deviceID, token: session.token)
  }

  func fetchAlbums(_ input: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    let offset: Int
    if let cursor = input.cursor {
      guard let value = Int(cursor), value >= 0 else { throw MusicSourceError.invalidCursor }
      offset = value
    } else {
      offset = 0
    }
    var query = [
      URLQueryItem(name: "Recursive", value: "true"),
      URLQueryItem(name: "IncludeItemTypes", value: "MusicAlbum"),
      URLQueryItem(name: "SortBy", value: "SortName"),
      URLQueryItem(name: "SortOrder", value: "Ascending"),
      URLQueryItem(name: "Fields", value: "ItemCounts"),
      URLQueryItem(name: "StartIndex", value: String(offset)),
      URLQueryItem(name: "Limit", value: "20"),
    ]
    if !input.searchTerm.isEmpty { query.append(URLQueryItem(name: "SearchTerm", value: input.searchTerm)) }
    let page = try await items(query: query)
    return FetchAlbumsResponse(
      albums: page.items.map { item in
        Album(
          id: item.id, title: item.name,
          albumArtist: item.albumArtist ?? item.artists?.joined(separator: ", ") ?? "Unknown Artist",
          year: item.productionYear, trackCount: item.childCount,
          artworkURL: item.imageTags?["Primary"].map { tag in
            request.url(path: ["Items", item.id, "Images", "Primary"], query: [URLQueryItem(name: "tag", value: tag)])
          }
        )
      },
      nextCursor: offset + page.items.count < page.totalRecordCount && !page.items.isEmpty
        ? String(offset + page.items.count) : nil
    )
  }

  func fetchAlbum(_ input: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    var tracks: [Track] = []
    var total = 0
    repeat {
      let page = try await items(query: [
        URLQueryItem(name: "ParentId", value: input.albumId),
        URLQueryItem(name: "IncludeItemTypes", value: "Audio"),
        URLQueryItem(name: "SortBy", value: "ParentIndexNumber,IndexNumber,SortName"),
        URLQueryItem(name: "SortOrder", value: "Ascending"),
        URLQueryItem(name: "StartIndex", value: String(tracks.count)),
        URLQueryItem(name: "Limit", value: "100"),
      ])
      total = page.totalRecordCount
      guard !page.items.isEmpty || tracks.count >= total else { throw MusicSourceError.invalidResponse }
      tracks.append(
        contentsOf: page.items.map { item in
          Track(
            id: item.id, relativePath: nil, title: item.name, artists: item.artists,
            trackNumber: item.indexNumber, discNumber: item.parentIndexNumber,
            durationSeconds: item.runTimeTicks.map { Double($0) / 10_000_000 }, format: item.container
          )
        })
    } while tracks.count < total
    return FetchAlbumResponse(total: total, items: tracks, nextCursor: nil)
  }

  func playableResource(for track: Track) async throws -> PlayableResource {
    _ = try await request.data(path: ["Users", session.userID, "Items", track.id])
    return PlayableResource(
      url: request.url(
        path: ["Audio", track.id, "stream"],
        query: [
          URLQueryItem(name: "static", value: "true"),
          URLQueryItem(name: "api_key", value: session.token),
        ]))
  }

  func artworkData(for url: URL) async throws -> Data {
    // Only the adapter's own server receives its authentication header.
    guard url.scheme == session.server.scheme, url.host == session.server.host,
      url.port == session.server.port
    else { throw MusicSourceError.invalidResponse }
    return try await request.data(url: url)
  }

  private func items(query: [URLQueryItem]) async throws -> Items {
    let data = try await request.data(path: ["Users", session.userID, "Items"], query: query)
    do { return try JSONDecoder().decode(Items.self, from: data) } catch { throw MusicSourceError.invalidResponse }
  }
}

private struct Items: Decodable {
  let items: [Item]
  let totalRecordCount: Int
  enum CodingKeys: String, CodingKey {
    case items = "Items"
    case totalRecordCount = "TotalRecordCount"
  }
}

private struct Item: Decodable {
  let id: String
  let name: String
  let albumArtist: String?
  let artists: [String]?
  let productionYear: Int?
  let childCount: Int?
  let imageTags: [String: String]?
  let indexNumber: Int?
  let parentIndexNumber: Int?
  let runTimeTicks: Int64?
  let container: String?

  enum CodingKeys: String, CodingKey {
    case id = "Id"
    case name = "Name"
    case albumArtist = "AlbumArtist"
    case artists = "Artists"
    case productionYear = "ProductionYear"
    case childCount = "ChildCount"
    case imageTags = "ImageTags"
    case indexNumber = "IndexNumber"
    case parentIndexNumber = "ParentIndexNumber"
    case runTimeTicks = "RunTimeTicks"
    case container = "Container"
  }
}
