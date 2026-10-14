@testable import Arcadia
import XCTest

final class PlaybackInterruptionTests: XCTestCase {
  @MainActor
  func testAnInterruptionPreservesTheQueueAndExplicitPausePreventsAutomaticResume() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let player = PlayerStore(source: source)
    player.play(tracks)
    for _ in 0..<100 {
      if player.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    let ids = player.queue.map(\.id)
    let current = player.currentEntryID
    let interruption = player.beginAudioInterruption()
    XCTAssertEqual(player.state, .paused)
    XCTAssertEqual(player.queue.map(\.id), ids)
    XCTAssertEqual(player.currentEntryID, current)
    player.pause()
    player.endAudioInterruption(interruption, shouldResume: true)
    try await Task.sleep(for: .milliseconds(200))
    XCTAssertFalse(player.isPlaybackRequested)
    XCTAssertEqual(player.state, .paused)
    XCTAssertEqual(player.queue.map(\.id), ids)
    player.stop()
  }
}
