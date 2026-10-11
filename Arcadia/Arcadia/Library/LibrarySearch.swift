import Foundation
import Observation

enum SearchCategory: String, CaseIterable, Identifiable {
  case songs, artists, albums, playlists
  var id: Self { self }
  var title: String { rawValue.capitalized }
}

struct LibrarySearchRequest {
  let query: String
  let category: SearchCategory
  let cursor: String?
}

enum LibrarySearchResult: Identifiable {
  case song(Track)
  case artist(Artist)
  case album(Album)
  case playlist(Playlist)

  var id: String {
    switch self {
    case .song(let song): "song:\(song.id)"
    case .artist(let artist): "artist:\(artist.id)"
    case .album(let album): "album:\(album.id)"
    case .playlist(let playlist): "playlist:\(playlist.id)"
    }
  }
}

@MainActor
@Observable
final class LibrarySearchModel {
  var query = ""
  var category = SearchCategory.songs
  private(set) var sections: [SearchCategory: PagedLibrary<LibrarySearchResult>] = [:]
  private var activeQuery = ""
  private var generation = UUID()
  private let source: any MusicSource
  @ObservationIgnored private var debounce: Task<Void, Never>?

  init(source: any MusicSource) { self.source = source }

  func search(immediately: Bool = false) {
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized == activeQuery, !sections.isEmpty { return }
    debounce?.cancel()
    for page in sections.values { page.cancelPendingRequest() }
    generation = UUID()
    let requestGeneration = generation
    activeQuery = normalized
    sections = [:]
    guard !normalized.isEmpty else { return }
    debounce = Task {
      if !immediately {
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
      }
      guard generation == requestGeneration else { return }
      let source = self.source
      let pages = Dictionary(
        uniqueKeysWithValues: SearchCategory.allCases.map { category in
          (
            category,
            PagedLibrary<LibrarySearchResult> { cursor in
              try await source.fetchSearch(LibrarySearchRequest(query: normalized, category: category, cursor: cursor))
            }
          )
        })
      sections = pages
      // Each query owns fresh page models. Completions from a previous query
      // can update only their discarded models, even if a source ignores cancel.
      for page in pages.values { Task { await page.open() } }
    }
  }
}
