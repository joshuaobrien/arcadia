@testable import Arcadia
import XCTest

final class PlaybackPersistenceTests: XCTestCase {
  @MainActor
  func testRestorePreservesOccurrencesAndManualQueueWithoutRequestingPlayback() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    var tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    tracks[0].artworkURL = URL(string: "https://example.test/art?token=never-persist-this")
    let first = PlayerStore(source: source)
    first.play(tracks)
    first.pause()
    first.append([tracks[1], tracks[1]])
    let binding = UUID()
    let ids = first.queue.map(\.id)
    let data = try XCTUnwrap(first.exportSession(sourceBinding: binding))
    XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("never-persist-this"))
    first.stop()
    let restored = PlayerStore(source: source)
    try restored.restoreSession(data, sourceBinding: binding)
    XCTAssertEqual(restored.queue.map(\.id), ids)
    XCTAssertEqual(restored.queue.map(\.origin), [.collection, .collection, .collection, .manual, .manual])
    XCTAssertEqual(restored.currentEntryID, ids.first)
    XCTAssertFalse(restored.isPlaybackRequested)
    for _ in 0..<100 {
      if restored.state == .paused { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertEqual(restored.state, .paused)
    XCTAssertFalse(restored.isPlaybackRequested)
    restored.stop()
  }

  @MainActor
  func testDifferentSourceAndCorruptSnapshotDoNotReplaceTheCurrentQueue() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let player = PlayerStore(source: source)
    player.play(tracks)
    player.pause()
    let ids = player.queue.map(\.id)
    let data = try XCTUnwrap(player.exportSession(sourceBinding: UUID()))
    XCTAssertThrowsError(try player.restoreSession(data, sourceBinding: UUID()))
    XCTAssertEqual(player.queue.map(\.id), ids)
    XCTAssertThrowsError(try player.restoreSession(Data("damaged".utf8), sourceBinding: UUID()))
    XCTAssertEqual(player.queue.map(\.id), ids)
    player.stop()
  }

  @MainActor
  func testUnavailableRestoredMusicKeepsRecoverableQueueAndDoesNotAutoplay() async throws {
    let available = FixtureAlbumClient(scenario: .success)
    let tracks = try await available.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let original = PlayerStore(source: available)
    original.play(tracks)
    original.pause()
    original.append([tracks[0]])
    let binding = UUID()
    let data = try XCTUnwrap(original.exportSession(sourceBinding: binding))
    let ids = original.queue.map(\.id)
    original.stop()
    let unavailable = PlayerStore(source: FixtureAlbumClient(scenario: .playbackFailure))
    try unavailable.restoreSession(data, sourceBinding: binding)
    for _ in 0..<100 {
      if unavailable.state == .failed { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertEqual(unavailable.state, .failed)
    XCTAssertNotNil(unavailable.errorText)
    XCTAssertEqual(unavailable.queue.map(\.id), ids)
    XCTAssertFalse(unavailable.isPlaybackRequested)
    XCTAssertNotNil(try unavailable.exportSession(sourceBinding: binding))
    unavailable.stop()
  }

  @MainActor
  func testExplicitPlaybackWinsOverAnOldRestorationRequest() async throws {
    let source = FixtureAlbumClient(scenario: .delayedPlayback)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let original = PlayerStore(source: source)
    original.play([tracks[0]])
    original.pause()
    let binding = UUID()
    let data = try XCTUnwrap(original.exportSession(sourceBinding: binding))
    original.stop()
    let restored = PlayerStore(source: source)
    try restored.restoreSession(data, sourceBinding: binding)
    restored.play([tracks[1]])
    let chosenID = restored.currentEntryID
    try await Task.sleep(for: .seconds(3))
    XCTAssertEqual(restored.currentEntryID, chosenID)
    XCTAssertEqual(restored.currentTrack?.id, tracks[1].id)
    XCTAssertEqual(restored.state, .playing)
    restored.stop()
  }
}
