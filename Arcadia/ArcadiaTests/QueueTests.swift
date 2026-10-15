import XCTest

@testable import Arcadia

final class QueueTests: XCTestCase {
  @MainActor
  func testAddingToEmptyQueueWaitsForExplicitPlaybackAndKeepsItsOrder() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let session = PlayerStore(source: source)
    session.append([tracks[1], tracks[2]])
    let addedIDs = session.queue.map(\.id)
    XCTAssertNil(session.currentEntryID)
    XCTAssertEqual(session.state, .idle)
    session.play([tracks[0]])
    XCTAssertTrue(session.needsReplacementConfirmation)
    XCTAssertEqual(session.queue.map(\.id), addedIDs)
    session.cancelReplacement()
    session.resume()
    XCTAssertEqual(session.currentEntryID, addedIDs.first)
    XCTAssertEqual(session.queue.map(\.id), addedIDs)
    XCTAssertEqual(session.currentTrack?.title, "The Second Song")
    session.playQueuedEntry(addedIDs[1])
    XCTAssertEqual(session.currentEntryID, addedIDs[1])
    XCTAssertEqual(session.currentTrack?.title, "The Third Song")
    XCTAssertEqual(session.queue.map(\.id), addedIDs)
    session.stop()
  }

  @MainActor
  func testUndoRemovesOnlyAddedUpcomingOccurrencesAndNeverCurrentSong() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let session = PlayerStore(source: source)
    session.play([tracks[0]])
    session.pause()
    session.append([tracks[1]])
    let earlierAddition = try XCTUnwrap(session.queueFeedback)
    let earlierID = session.upcoming[0].id
    session.append([tracks[1], tracks[2]])
    let latestAddition = try XCTUnwrap(session.queueFeedback)
    session.moveUpcoming(earlierID, by: 2)
    session.undoAddition(earlierAddition.id) // An expired feedback action cannot undo a later addition.
    XCTAssertEqual(session.upcoming.count, 3)
    session.playNext()
    let currentID = session.currentEntryID
    session.pause()
    session.undoAddition(latestAddition.id)
    XCTAssertEqual(session.currentEntryID, currentID)
    XCTAssertEqual(session.currentTrack?.title, "The Second Song")
    XCTAssertEqual(session.upcoming.map(\.id), [earlierID])
    XCTAssertEqual(session.state, .paused)
    XCTAssertNil(session.queueFeedback)
    session.stop()
  }

  @MainActor
  func testReplacementRequiresConfirmationOnlyForManualUpcomingEntries() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let session = PlayerStore(source: source)
    session.play(tracks)
    session.pause()
    session.append([tracks[1]])
    let originalID = session.currentEntryID
    let originalQueue = session.queue.map(\.id)
    session.play([tracks[2]])
    XCTAssertTrue(session.needsReplacementConfirmation)
    XCTAssertEqual(session.currentEntryID, originalID)
    XCTAssertEqual(session.queue.map(\.id), originalQueue)
    session.cancelReplacement()
    XCTAssertFalse(session.needsReplacementConfirmation)
    XCTAssertEqual(session.state, .paused)
    session.play([tracks[2]])
    session.confirmReplacement()
    XCTAssertEqual(session.queue.map(\.track.title), ["The Third Song"])
    XCTAssertNotEqual(session.currentEntryID, originalID)
    session.play(tracks)
    XCTAssertFalse(session.needsReplacementConfirmation)
    XCTAssertEqual(session.queue.map(\.track.title), ["The First Song", "The Second Song", "The Third Song"])
    session.stop()
  }

  @MainActor
  func testUpcomingDuplicateEditsPreserveCurrentOccurrence() async throws {
    let source = FixtureAlbumClient(scenario: .success)
    let tracks = try await source.fetchAlbum(FetchAlbumRequest(albumId: "fixture-1")).items
    let session = PlayerStore(source: source)
    session.play([tracks[0]])
    session.pause()
    let currentID = try XCTUnwrap(session.currentEntryID)
    session.append([tracks[1], tracks[1], tracks[2]])
    let firstDuplicate = session.upcoming[0].id
    let secondDuplicate = session.upcoming[1].id
    XCTAssertNotEqual(firstDuplicate, secondDuplicate)
    session.removeUpcoming(firstDuplicate)
    XCTAssertEqual(session.upcoming.map(\.track.title), ["The Second Song", "The Third Song"])
    XCTAssertEqual(session.upcoming.first?.id, secondDuplicate)
    session.moveUpcoming(secondDuplicate, by: 1)
    XCTAssertEqual(session.upcoming.map(\.track.title), ["The Third Song", "The Second Song"])
    session.removeUpcoming(currentID)
    XCTAssertEqual(session.currentEntryID, currentID)
    XCTAssertEqual(session.state, .paused)
    XCTAssertEqual(session.currentTime, 0)
    session.playNext()
    XCTAssertEqual(session.currentTrack?.title, "The Third Song")
    session.playNext()
    XCTAssertEqual(session.currentEntryID, secondDuplicate)
    session.stop()
  }
}
