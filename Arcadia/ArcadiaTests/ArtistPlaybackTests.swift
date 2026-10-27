import Foundation
import XCTest

@testable import Arcadia

final class ArtistPlaybackTests: XCTestCase {
  @MainActor
  func testArtistPlayLoadsEveryPageBeforeReplacingQueue() async throws {
    let fixture = FixtureAlbumClient(scenario: .success)
    let tracks = try await fixture.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let source = PagedArtistSource(fixture: fixture, tracks: tracks, failsLater: false)
    let model = ArtistLibraryModel(artist: Artist(id: "artist", name: "Artist", artworkURL: nil), source: source)
    let player = PlayerStore(source: source)
    await model.songs.open()
    XCTAssertEqual(model.songs.items.count, 1)
    await model.play(using: player)
    XCTAssertEqual(player.queue.map(\.track.id), tracks.map(\.id))
    XCTAssertNil(model.playError)
    player.stop()
  }

  @MainActor
  func testLaterArtistPageFailureDoesNotReplaceExistingQueue() async throws {
    let fixture = FixtureAlbumClient(scenario: .success)
    let tracks = try await fixture.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let source = PagedArtistSource(fixture: fixture, tracks: tracks, failsLater: true)
    let model = ArtistLibraryModel(artist: Artist(id: "artist", name: "Artist", artworkURL: nil), source: source)
    let player = PlayerStore(source: source)
    player.play([tracks[2]])
    player.pause()
    let original = player.queue.map(\.id)
    await model.songs.open()
    await model.play(using: player)
    XCTAssertNotNil(model.playError)
    XCTAssertEqual(player.queue.map(\.id), original)
    XCTAssertFalse(player.isPlaybackRequested)
    player.stop()
  }
}

private actor PagedArtistSource: MusicSource {
  let fixture: FixtureAlbumClient
  let tracks: [Track]
  let failsLater: Bool

  init(fixture: FixtureAlbumClient, tracks: [Track], failsLater: Bool) {
    self.fixture = fixture
    self.tracks = tracks
    self.failsLater = failsLater
  }

  func fetchSongs(_ request: SongBrowseRequest) async throws -> LibraryPage<Track> {
    if request.cursor == nil { return LibraryPage(items: [tracks[0]], nextCursor: "later") }
    if failsLater { throw MusicSourceError.unavailable }
    return LibraryPage(items: Array(tracks.dropFirst()), nextCursor: nil)
  }

  func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    try await fixture.fetchAlbums(request)
  }

  func fetchAlbum(_ request: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    try await fixture.fetchAlbum(request)
  }

  func playableResource(for track: Track) async throws -> PlayableResource {
    try await fixture.playableResource(for: track)
  }

  func artworkData(for url: URL) async throws -> Data { try await fixture.artworkData(for: url) }
}
