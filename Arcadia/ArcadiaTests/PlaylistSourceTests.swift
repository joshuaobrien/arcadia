@testable import Arcadia
import Foundation
import XCTest

final class PlaylistSourceTests: XCTestCase {
  @MainActor
  func testRealPlaylistsKeepSourceOrderAndDuplicateSongsAcrossPages() async throws {
    let file = URL(fileURLWithPath: "/tmp/arcadia-jellyfin-fixture.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      throw XCTSkip("Requires disposable playlist fixture")
    }
    let fixture = try JSONDecoder().decode(PlaylistFixture.self, from: Data(contentsOf: file))
    let connection = try await JellyfinConnector().connect(
      server: XCTUnwrap(URL(string: fixture.server)), username: fixture.username, password: fixture.password)
    let source = connection.source
    let first = try await source.fetchPlaylists(PlaylistBrowseRequest(cursor: nil, searchTerm: ""))
    XCTAssertEqual(first.items.count, 20)
    let second = try await source.fetchPlaylists(PlaylistBrowseRequest(cursor: first.nextCursor, searchTerm: ""))
    XCTAssertEqual(second.items.count, 4)
    XCTAssertNil(second.nextCursor)
    XCTAssertEqual(Set((first.items + second.items).map(\.id)).count, 24)
    let songs = try await source.fetchPlaylistSongs(playlistID: fixture.playlistID, cursor: nil)
    XCTAssertEqual(songs.items.count, 20)
    let more = try await source.fetchPlaylistSongs(playlistID: fixture.playlistID, cursor: songs.nextCursor)
    XCTAssertEqual(more.items.count, 4)
    let ordered = songs.items + more.items
    XCTAssertEqual(ordered.map(\.track.id), fixture.playlistSongIDs)
    XCTAssertEqual(Set(ordered.map(\.id)).count, 24)
    XCTAssertNotEqual(ordered[0].id, ordered[2].id)
    XCTAssertEqual(ordered[0].track.id, ordered[2].track.id)
    let empty = try await source.fetchPlaylistSongs(playlistID: fixture.emptyPlaylistID, cursor: nil)
    XCTAssertTrue(empty.items.isEmpty)
    XCTAssertNil(empty.nextCursor)
  }
}

private struct PlaylistFixture: Decodable {
  let server: String
  let username: String
  let password: String
  let playlistID: String
  let emptyPlaylistID: String
  let playlistSongIDs: [String]
}
