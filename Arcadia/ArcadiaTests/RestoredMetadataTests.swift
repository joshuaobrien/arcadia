@testable import Arcadia
import Foundation
import MediaPlayer
import XCTest

final class RestoredMetadataTests: XCTestCase {
  @MainActor
  func testPausedRestoreHydratesOnlyTheCurrentOccurrenceAndKeepsURLsOutOfSnapshots() async throws {
    try await assertRestoredMetadata(matchesCurrentSong: true)
  }

  @MainActor
  func testPausedRestoreIgnoresMetadataForAnotherSong() async throws {
    try await assertRestoredMetadata(matchesCurrentSong: false)
  }

  @MainActor
  private func assertRestoredMetadata(matchesCurrentSong: Bool) async throws {
    let fixture = FixtureAlbumClient(scenario: .success)
    let tracks = try await fixture.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let original = PlayerStore(source: fixture)
    original.play([tracks[0]])
    for _ in 0..<100 {
      if original.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(original.isPlaying)
    original.seek(to: 5, resumeAfterSeeking: false)
    for _ in 0..<100 {
      if abs(original.currentTime - 5) < 0.2 { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertEqual(original.currentTime, 5, accuracy: 0.2)
    original.append([tracks[0]])
    let binding = UUID()
    let beforeIDs = original.queue.map(\.id)
    let beforeOrigins = original.queue.map(\.origin)
    let data = try XCTUnwrap(original.exportSession(sourceBinding: binding))
    original.stop()
    var metadata = matchesCurrentSong ? tracks[0] : tracks[1]
    let artwork = try XCTUnwrap(URL(string: "https://source.example/art?token=private-artwork-token"))
    metadata.artworkURL = artwork
    metadata.albumReference = AlbumReference(
      id: "release", title: "Release", artworkURL: artwork, albumArtist: "Artist")
    metadata.artistReferences = [Artist(id: "artist", name: "Artist", artworkURL: artwork)]
    let source = MetadataResolvingSource(fixture: fixture, metadata: metadata)
    let restored = PlayerStore(source: source)
    let bridge = MediaPlaybackBridge(player: restored, source: source)
    defer { bridge.close() }
    try restored.restoreSession(data, sourceBinding: binding)
    await source.waitForRequest()
    for _ in 0..<100 {
      if MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] != nil { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    XCTAssertNotNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle])
    XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork])
    await source.releaseMetadata()
    for _ in 0..<100 {
      if restored.state == .paused { break }
      try await Task.sleep(for: .milliseconds(30))
    }

    XCTAssertEqual(restored.state, .paused)
    XCTAssertFalse(restored.isPlaybackRequested)
    XCTAssertEqual(restored.currentTime, 5, accuracy: 0.2)
    XCTAssertEqual(restored.queue.map(\.id), beforeIDs)
    XCTAssertEqual(restored.queue.map(\.origin), beforeOrigins)
    XCTAssertEqual(restored.currentEntryID, beforeIDs[0])
    XCTAssertEqual(restored.currentTrack?.id, tracks[0].id)
    XCTAssertEqual(restored.currentTrack?.artworkURL, matchesCurrentSong ? artwork : nil)
    XCTAssertNil(restored.queue[1].track.artworkURL)
    if matchesCurrentSong {
      for _ in 0..<100 {
        if MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] != nil { break }
        try await Task.sleep(for: .milliseconds(10))
      }
      XCTAssertNotNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork])
    } else {
      XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork])
    }
    let exported = try XCTUnwrap(restored.exportSession(sourceBinding: binding))
    let snapshot = String(decoding: exported, as: UTF8.self)
    XCTAssertFalse(snapshot.contains("private-artwork-token"))
    XCTAssertFalse(snapshot.contains("https://source.example"))
    XCTAssertFalse(snapshot.contains("artworkURL"))
    let requests = await source.resolutionCount()
    XCTAssertEqual(requests, 1)
    restored.stop()
  }
}

private actor MetadataResolvingSource: MusicSource {
  let fixture: FixtureAlbumClient
  let metadata: Track
  private var resolutions = 0
  private var requestWaiter: CheckedContinuation<Void, Never>?
  private var release: CheckedContinuation<Void, Never>?

  init(fixture: FixtureAlbumClient, metadata: Track) {
    self.fixture = fixture
    self.metadata = metadata
  }

  func resolutionCount() -> Int { resolutions }

  func waitForRequest() async {
    if resolutions > 0 { return }
    await withCheckedContinuation { requestWaiter = $0 }
  }
  func releaseMetadata() {
    release?.resume()
    release = nil
  }

  func playableResource(for track: Track) async throws -> PlayableResource {
    resolutions += 1
    await withCheckedContinuation {
      release = $0
      requestWaiter?.resume()
      requestWaiter = nil
    }
    let resource = try await fixture.playableResource(for: track)
    return PlayableResource(url: resource.url, resolvedTrack: metadata)
  }

  func artworkData(for _: URL) async throws -> Data {
    guard let file = Bundle.main.url(forResource: "FixtureArtwork", withExtension: "png") else {
      throw MusicSourceError.invalidResponse
    }
    return try Data(contentsOf: file)
  }
  func fetchAlbum(_ request: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    try await fixture.fetchAlbum(request)
  }
  func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    try await fixture.fetchAlbums(request)
  }
}
