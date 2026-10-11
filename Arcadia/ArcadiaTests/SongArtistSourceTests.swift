import Foundation
import XCTest

@testable import Arcadia

final class SongArtistSourceTests: XCTestCase {
  @MainActor
  func testRealSongsArtistsAndReleaseRelationships() async throws {
    let file = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Start the disposable 23 artist Jellyfin fixture to verify browsing.")
    }
    let fixture = try JSONDecoder().decode(SongArtistFixture.self, from: Data(contentsOf: file))
    let server = try XCTUnwrap(URL(string: fixture.server))
    let connection = try await JellyfinConnector().connect(server: server, username: fixture.username, password: fixture.password)
    let source = connection.source
    let firstSongs = try await source.fetchSongs(SongBrowseRequest(cursor: nil, searchTerm: ""))
    XCTAssertEqual(firstSongs.items.count, 20)
    let secondSongs = try await source.fetchSongs(SongBrowseRequest(cursor: firstSongs.nextCursor, searchTerm: ""))
    XCTAssertEqual(secondSongs.items.count, 6)
    XCTAssertNil(secondSongs.nextCursor)
    let songs = firstSongs.items + secondSongs.items
    XCTAssertEqual(Set(songs.map(\.id)).count, 26)
    let firstArtists = try await source.fetchArtists(ArtistBrowseRequest(cursor: nil, searchTerm: ""))
    XCTAssertEqual(firstArtists.items.count, 20)
    let secondArtists = try await source.fetchArtists(ArtistBrowseRequest(cursor: firstArtists.nextCursor, searchTerm: ""))
    XCTAssertEqual(secondArtists.items.count, 3)
    XCTAssertNil(secondArtists.nextCursor)
    let artists = firstArtists.items + secondArtists.items
    XCTAssertEqual(Set(artists.map(\.id)).count, 23)
    let artist = try XCTUnwrap(artists.first { $0.name == "Arcadia Test Ensemble" })
    let artistSongs = try await source.fetchSongs(SongBrowseRequest(cursor: nil, searchTerm: "", artistID: artist.id))
    XCTAssertEqual(artistSongs.items.count, 4)
    XCTAssertTrue(artistSongs.items.allSatisfy { $0.artistReferences?.contains { $0.id == artist.id } == true })
    let releases = try await source.fetchArtistAlbums(artistID: artist.id, cursor: nil)
    XCTAssertEqual(Set(releases.albums.map(\.title)), ["Fixture Album 02", "Orb Sessions"])
    let standalone = try await source.fetchSongs(SongBrowseRequest(cursor: nil, searchTerm: "Persistent State"))
    let song = try XCTUnwrap(standalone.items.first)
    XCTAssertEqual(standalone.items.count, 1)
    XCTAssertEqual(song.title, "Persistent State")
    XCTAssertEqual(song.albumReference?.title, "Orb Sessions")
    XCTAssertEqual(song.albumReference?.albumArtist, "Arcadia Test Ensemble")
    XCTAssertEqual(song.albumReference?.id, releases.albums.first { $0.title == "Orb Sessions" }?.id)
    let artwork = try XCTUnwrap(song.artworkURL)
    XCTAssertFalse(artwork.absoluteString.contains("api_key"))
    let image = try await source.artworkData(for: artwork)
    XCTAssertGreaterThan(image.count, 100)
  }
}

private struct SongArtistFixture: Decodable {
  let server: String
  let username: String
  let password: String
}
