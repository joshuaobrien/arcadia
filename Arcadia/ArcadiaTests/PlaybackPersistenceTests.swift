import XCTest

@testable import Arcadia

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
}
