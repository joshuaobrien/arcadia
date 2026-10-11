import Foundation
import Observation

@MainActor
@Observable
final class PlaylistDetailModel {
  let songs: PagedLibrary<PlaylistSong>
  private(set) var isPreparing = false
  private(set) var playError: String?
  private let playlistID: String
  private let source: any MusicSource
  private var generation = 0
  @ObservationIgnored private var preparation: Task<Void, Never>?

  init(playlist: Playlist, source: any MusicSource) {
    playlistID = playlist.id
    self.source = source
    songs = PagedLibrary { try await source.fetchPlaylistSongs(playlistID: playlist.id, cursor: $0) }
  }

  func play(using player: PlayerStore) {
    guard !isPreparing else { return }
    generation += 1
    let request = generation
    let choice = player.playbackChoiceRevision
    isPreparing = true
    playError = nil
    preparation = Task {
      defer {
        if generation == request {
          isPreparing = false
          preparation = nil
        }
      }
      do {
        var tracks: [Track] = []
        var cursor: String?
        var visited = Set<String>()
        repeat {
          let page = try await source.fetchPlaylistSongs(playlistID: playlistID, cursor: cursor)
          guard generation == request, !Task.isCancelled else { return }
          tracks.append(contentsOf: page.items.map(\.track))
          cursor = page.nextCursor
          if let cursor, !visited.insert(cursor).inserted { throw MusicSourceError.invalidCursor }
        } while cursor != nil
        guard !tracks.isEmpty, generation == request, player.playbackChoiceRevision == choice else { return }
        // The central command evaluates queue safeguards against the current
        // session after every source page has loaded successfully.
        player.play(tracks)
      } catch {
        guard generation == request, !Task.isCancelled else { return }
        playError = error.localizedDescription
      }
    }
  }

  func cancelPreparation() {
    generation += 1
    preparation?.cancel()
    preparation = nil
    isPreparing = false
  }
}
