import XCTest

@testable import Arcadia

final class PreviousPlaybackTests: XCTestCase {
  @MainActor
  func testPreviousReturnsToThePrecedingDuplicateOccurrenceWithoutStartingPausedPlayback() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let player = PlayerStore(source: source)
    defer { player.stop() }
    player.play([tracks[0], tracks[1], tracks[1]])
    let entries = player.queue.map(\.id)
    player.playQueuedEntry(entries[2])
    player.pause()

    player.playPrevious()

    XCTAssertEqual(player.currentEntryID, entries[1])
    XCTAssertEqual(player.queue.map(\.id), entries)
    XCTAssertFalse(player.isPlaybackRequested)
    XCTAssertEqual(player.state, .paused)
  }

  @MainActor
  func testExactlyThreeSecondsRestartsTheCurrentOccurrenceAndPreservesPause() async throws {
    let player = try await restoredPlayer(position: 3)
    defer { player.stop() }
    let occurrence = player.currentEntryID
    let queue = player.queue.map(\.id)

    player.playPrevious()

    XCTAssertEqual(player.currentEntryID, occurrence)
    XCTAssertEqual(player.currentTime, 0)
    XCTAssertEqual(player.queue.map(\.id), queue)
    XCTAssertFalse(player.isPlaybackRequested)
    XCTAssertEqual(player.state, .paused)
  }

  @MainActor
  func testBelowThreeSecondsReturnsToThePreviousOccurrence() async throws {
    let player = try await restoredPlayer(position: 2.999)
    defer { player.stop() }
    let queue = player.queue.map(\.id)

    player.playPrevious()

    XCTAssertEqual(player.currentEntryID, queue[0])
    XCTAssertEqual(player.currentTime, 0)
    XCTAssertEqual(player.queue.map(\.id), queue)
    XCTAssertFalse(player.isPlaybackRequested)
  }

  @MainActor
  func testFirstEntryRestartsAndEmptyQueueDoesNothing() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let player = PlayerStore(source: source)
    defer { player.stop() }
    player.playPrevious()
    XCTAssertEqual(player.state, .idle)
    XCTAssertTrue(player.queue.isEmpty)
    XCTAssertNil(player.currentEntryID)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    player.play(tracks)
    player.pause()
    let first = player.currentEntryID

    player.playPrevious()

    XCTAssertEqual(player.currentEntryID, first)
    XCTAssertEqual(player.currentTime, 0)
    XCTAssertFalse(player.isPlaybackRequested)
  }

  @MainActor
  func testPreviousKeepsPlayingIntentAndResolvedAudioResumesAtTheBeginning() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let player = PlayerStore(source: source)
    defer { player.stop() }
    player.play(tracks)
    let first = player.currentEntryID
    player.playNext()

    player.playPrevious()

    XCTAssertEqual(player.currentEntryID, first)
    XCTAssertTrue(player.isPlaybackRequested)
    for _ in 0..<100 {
      if player.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    XCTAssertLessThan(player.currentTime, 3)
  }

  @MainActor
  func testReadySongRestartsAndResumesWhenMusicSourceBecomesUnavailable() async throws {
    let fixture = FixtureAlbumClient(scenario: .success)
    let source = DisconnectablePlaybackSource(fixture: fixture)
    let tracks = try await fixture.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let player = PlayerStore(source: source)
    defer { player.stop() }
    player.play(tracks)
    for _ in 0..<100 {
      if player.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    player.pause()
    player.seek(to: 4, resumeAfterSeeking: false)
    for _ in 0..<100 {
      if player.currentTime >= 3 { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertGreaterThanOrEqual(player.currentTime, 3)
    let occurrence = player.currentEntryID
    let entries = player.queue.map(\.id)
    await source.disconnect()

    player.playPrevious()
    try await Task.sleep(for: .milliseconds(300))

    XCTAssertEqual(player.state, .paused)
    XCTAssertFalse(player.isPlaybackRequested)
    XCTAssertNil(player.errorText)
    XCTAssertLessThan(player.currentTime, 1)
    XCTAssertEqual(player.currentEntryID, occurrence)
    XCTAssertEqual(player.queue.map(\.id), entries)
    player.resume()
    for _ in 0..<100 {
      if player.isPlaying || player.state == .failed { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    XCTAssertNil(player.errorText)
  }

  @MainActor
  private func restoredPlayer(position: Double) async throws -> PlayerStore {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let entries = [QueueEntry(track: tracks[0]), QueueEntry(track: tracks[1])]
    let binding = UUID()
    let data = try XCTUnwrap(
      PlaybackSnapshot.encode(
        sourceBinding: binding, entries: entries, currentEntryID: entries[1].id, position: position))
    let player = PlayerStore(source: source)
    try player.restoreSession(data, sourceBinding: binding)
    XCTAssertEqual(player.currentTime, position)
    return player
  }

}

private actor DisconnectablePlaybackSource: MusicSource {
  let fixture: FixtureAlbumClient
  private var isAvailable = true

  init(fixture: FixtureAlbumClient) { self.fixture = fixture }
  func disconnect() { isAvailable = false }

  func playableResource(for track: Track) async throws -> PlayableResource {
    guard isAvailable else { throw MusicSourceError.unavailable }
    return try await fixture.playableResource(for: track)
  }
  func fetchAlbum(_ request: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    try await fixture.fetchAlbum(request)
  }
  func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    try await fixture.fetchAlbums(request)
  }
  func artworkData(for url: URL) async throws -> Data {
    try await fixture.artworkData(for: url)
  }
}
