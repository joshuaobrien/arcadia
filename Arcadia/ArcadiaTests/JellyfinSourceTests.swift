import Foundation
import XCTest

@testable import Arcadia

final class JellyfinSourceTests: XCTestCase {
  @MainActor
  func testRealSourceContract() async throws {
    let file = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Start the disposable Jellyfin integration fixture to verify this contract.")
    }
    let configuration = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: file))
    let server = try XCTUnwrap(URL(string: configuration.server))
    let connector = JellyfinConnector()
    let connection = try await connector.connect(
      server: server, username: configuration.username, password: configuration.password
    )
    let source = connection.source
    let first = try await source.fetchAlbums(FetchAlbumsRequest(cursor: nil, searchTerm: ""))
    XCTAssertEqual(first.albums.count, 20)
    XCTAssertEqual(first.totalCount, 24)
    XCTAssertEqual(first.nextCursor, "20")
    let second = try await source.fetchAlbums(FetchAlbumsRequest(cursor: first.nextCursor, searchTerm: ""))
    XCTAssertEqual(second.albums.count, 4)
    XCTAssertNil(second.nextCursor)
    XCTAssertEqual(Set((first.albums + second.albums).map(\.id)).count, 24)
    let searched = try await source.fetchAlbums(FetchAlbumsRequest(cursor: nil, searchTerm: "Orb Sessions"))
    XCTAssertEqual(searched.albums.count, 1)
    XCTAssertEqual(searched.totalCount, 1)
    let album = try XCTUnwrap(searched.albums.first)
    XCTAssertEqual(album.title, "Orb Sessions")
    XCTAssertEqual(album.albumArtist, "Arcadia Test Ensemble")
    XCTAssertEqual(album.year, 2026)
    let artwork = try XCTUnwrap(album.artworkURL)
    XCTAssertFalse(artwork.absoluteString.contains("Token"))
    XCTAssertFalse(artwork.absoluteString.contains("api_key"))
    let image = try await source.artworkData(for: artwork)
    XCTAssertGreaterThan(image.count, 100)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: album.id))
    XCTAssertEqual(tracks.total, 3)
    XCTAssertEqual(tracks.items.map(\.title), ["First Contact", "Persistent State", "Range Request"])
    XCTAssertEqual(tracks.items.map(\.trackNumber), [1, 2, 3])
    XCTAssertTrue(tracks.items.allSatisfy { ($0.durationSeconds ?? 0) >= 11 })
    let song = try XCTUnwrap(tracks.items.first)
    let resource = try await source.playableResource(for: song)
    var request = URLRequest(url: resource.url)
    request.setValue("bytes=0-1023", forHTTPHeaderField: "Range")
    let audio: Data
    let response: URLResponse
    do { (audio, response) = try await URLSession.shared.data(for: request) } catch {
      // Underlying transport errors can include the authenticated URL.
      throw MusicSourceError.unavailable
    }
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 206)
    XCTAssertEqual(audio.count, 1024)
    let restored = try await connector.restore(connection.savedSession)
    let restoredAlbums = try await restored.source.fetchAlbums(
      FetchAlbumsRequest(cursor: nil, searchTerm: "Orb Sessions"))
    XCTAssertEqual(restoredAlbums.albums.map(\.id), [album.id])
    do {
      let unrelated = try XCTUnwrap(URL(string: "https://unrelated.example/image"))
      _ = try await source.artworkData(for: unrelated)
      XCTFail("Authenticated artwork must not be requested from another server")
    } catch MusicSourceError.invalidResponse {
      // Public source contract rejects artwork outside its own origin before sending credentials.
    }
  }
}

private struct Fixture: Decodable {
  let server: String
  let username: String
  let password: String
}
