@testable import Arcadia
import Foundation
import XCTest

final class PlaybackLifecycleTests: XCTestCase {
  @MainActor
  func testRouteLossRejectsAPlaylistPreparedBeforeTheRouteChanged() async throws {
    try await assertPreparedPlaylistStaysCancelled(after: { player in
      let token = player.beginAudioInterruption()
      player.endAudioInterruption(token, shouldResume: false)
    })
  }

  @MainActor
  func testActiveInterruptionRejectsAPlaylistPreparedBeforeTheInterruption() async throws {
    try await assertPreparedPlaylistStaysCancelled(after: { player in
      _ = player.beginAudioInterruption()
    })
  }

  @MainActor
  func testStopRejectsAPlaylistPreparedBeforeSessionTeardown() async throws {
    try await assertPreparedPlaylistStaysCancelled(after: { $0.stop() }, clearsQueue: true, expectedState: .idle)
  }

  @MainActor
  func testReleasedTransportRejectsAPlaylistPreparedBeforeSessionTeardown() async throws {
    try await assertPreparedPlaylistStaysCancelled(after: { $0.releaseTransport() })
  }

  @MainActor
  func testMediaServicesResetKeepsQueueAndPositionPausedUntilDeliberateFreshResolution() async throws {
    let fixture = FixtureAlbumClient(scenario: .success)
    let tracks = try await fixture.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let source = DelayedPlaylistSource(fixture: fixture, track: tracks[1])
    var activations = 0
    let player = PlayerStore(source: source, activateAudio: { activations += 1 })
    player.play(tracks)
    for _ in 0..<100 {
      if player.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    player.seek(to: 5, resumeAfterSeeking: false)
    for _ in 0..<100 {
      if abs(player.currentTime - 5) < 0.2 { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertEqual(player.currentTime, 5, accuracy: 0.2)
    player.resume()
    let queue = player.queue.map(\.id)
    let occurrence = player.currentEntryID
    let activationCount = activations
    let requestsBefore = await source.resourceRequestCount()

    player.setVolume(0.25)
    player.resetAudioServices()
    XCTAssertEqual(player.volume, 0.25)
    try await Task.sleep(for: .milliseconds(150))
    XCTAssertEqual(player.queue.map(\.id), queue)
    XCTAssertEqual(player.currentEntryID, occurrence)
    XCTAssertEqual(player.currentTime, 5, accuracy: 0.3)
    XCTAssertEqual(player.state, .paused)
    XCTAssertFalse(player.isPlaybackRequested)
    XCTAssertEqual(activations, activationCount)
    let requestsWhilePaused = await source.resourceRequestCount()
    XCTAssertEqual(requestsWhilePaused, requestsBefore)

    player.resume()
    for _ in 0..<100 {
      if player.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    XCTAssertGreaterThan(activations, activationCount)
    let requestsAfterResume = await source.resourceRequestCount()
    XCTAssertEqual(requestsAfterResume, requestsBefore + 1)
    XCTAssertEqual(player.currentEntryID, occurrence)
    XCTAssertEqual(player.currentTime, 5, accuracy: 0.5)
    player.stop()
  }

  @MainActor
  private func assertPreparedPlaylistStaysCancelled(
    after event: @MainActor (PlayerStore) -> Void, clearsQueue: Bool = false,
    expectedState: PlayerStore.State = .paused
  ) async throws {
    let fixture = FixtureAlbumClient(scenario: .success)
    let tracks = try await fixture.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let source = DelayedPlaylistSource(fixture: fixture, track: tracks[1])
    var activations = 0
    let player = PlayerStore(source: source, activateAudio: { activations += 1 })
    player.play([tracks[0]])
    for _ in 0..<100 {
      if player.isPlaying { break }
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(player.isPlaying)
    let originalQueue = player.queue.map(\.id)
    let explicitChoice = player.playbackChoiceRevision
    let playlist = Playlist(id: "slow", title: "Slow playlist", artworkURL: nil)
    let model = PlaylistDetailModel(playlist: playlist, source: source)
    model.play(using: player)
    await source.waitForRequest()

    let activationsBefore = activations
    let requestsBefore = await source.resourceRequestCount()
    event(player)
    await source.finishPage()
    for _ in 0..<1000 {
      if !model.isPreparing { break }
      await Task.yield()
    }

    XCTAssertFalse(model.isPreparing)
    XCTAssertEqual(player.queue.map(\.id), clearsQueue ? [] : originalQueue)
    XCTAssertFalse(player.isPlaybackRequested)
    XCTAssertEqual(player.state, expectedState)
    XCTAssertEqual(player.playbackChoiceRevision, explicitChoice)
    XCTAssertEqual(activations, activationsBefore)
    let requestsAfter = await source.resourceRequestCount()
    XCTAssertEqual(requestsAfter, requestsBefore)
    player.stop()
  }
}

private actor DelayedPlaylistSource: MusicSource {
  let fixture: FixtureAlbumClient
  let track: Track
  private var page: CheckedContinuation<LibraryPage<PlaylistSong>, Never>?
  private var requestStarted = false
  private var resourceRequests = 0
  private var requestWaiter: CheckedContinuation<Void, Never>?

  init(fixture: FixtureAlbumClient, track: Track) {
    self.fixture = fixture
    self.track = track
  }

  func waitForRequest() async {
    if requestStarted { return }
    await withCheckedContinuation { requestWaiter = $0 }
  }

  func finishPage() {
    page?.resume(returning: LibraryPage(items: [PlaylistSong(id: "entry", track: track)], nextCursor: nil))
    page = nil
  }

  func fetchPlaylistSongs(playlistID _: String, cursor _: String?) async throws -> LibraryPage<PlaylistSong> {
    await withCheckedContinuation {
      page = $0
      requestStarted = true
      requestWaiter?.resume()
      requestWaiter = nil
    }
  }

  func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    try await fixture.fetchAlbums(request)
  }

  func fetchAlbum(_ request: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    try await fixture.fetchAlbum(request)
  }

  func resourceRequestCount() -> Int { resourceRequests }

  func playableResource(for track: Track) async throws -> PlayableResource {
    resourceRequests += 1
    return try await fixture.playableResource(for: track)
  }

  func artworkData(for url: URL) async throws -> Data {
    try await fixture.artworkData(for: url)
  }
}
