import Foundation
import Observation

@MainActor
@Observable
final class PagedLibrary<Item: Identifiable> {
  private(set) var items: [Item] = []
  private(set) var isLoading = false
  private(set) var hasOpened = false
  private(set) var errorText: String?
  private(set) var totalCount: Int?
  var countText: String { libraryCountText(total: totalCount, loaded: items.count, hasMore: nextCursor != nil) }
  private(set) var nextCursor: String?
  var scrollAnchor: Item.ID?
  private let fetch: (String?) async throws -> LibraryPage<Item>
  @ObservationIgnored private var requestTask: Task<Void, Never>?

  init(fetch: @escaping (String?) async throws -> LibraryPage<Item>) { self.fetch = fetch }

  func open() async {
    if let requestTask {
      await requestTask.value
      return
    }
    guard !hasOpened else { return }
    hasOpened = true
    await load(cursor: nil)
  }

  func next() async {
    guard let nextCursor, !isLoading, errorText == nil else { return }
    await load(cursor: nextCursor)
  }

  func retry() async {
    guard errorText != nil, !isLoading else { return }
    await load(cursor: nextCursor)
  }

  func cancelPendingRequest() { requestTask?.cancel() }

  private func load(cursor: String?) async {
    guard !isLoading else { return }
    isLoading = true
    errorText = nil
    // Shared feature state owns the request, independent of a presentation task.
    let task = Task {
      defer { isLoading = false }
      do {
        let page = try await fetch(cursor)
        guard !Task.isCancelled else { return }
        var identities = Set(items.map(\.id))
        items.append(contentsOf: page.items.filter { identities.insert($0.id).inserted })
        totalCount = page.totalCount ?? totalCount
        nextCursor = page.nextCursor
      } catch {
        guard !Task.isCancelled else { return }
        errorText = error.localizedDescription
      }
    }
    requestTask = task
    await task.value
    requestTask = nil
  }
}

@MainActor
@Observable
final class LibraryModel {
  let songs: PagedLibrary<Track>
  let artists: PagedLibrary<Artist>
  let playlists: PagedLibrary<Playlist>
  let search: LibrarySearchModel
  private let source: any MusicSource
  private var artistLibraries: [String: ArtistLibraryModel] = [:]

  init(source: any MusicSource) {
    self.source = source
    search = LibrarySearchModel(source: source)
    playlists = PagedLibrary { try await source.fetchPlaylists(PlaylistBrowseRequest(cursor: $0, searchTerm: "")) }
    songs = PagedLibrary { try await source.fetchSongs(SongBrowseRequest(cursor: $0, searchTerm: "")) }
    artists = PagedLibrary { try await source.fetchArtists(ArtistBrowseRequest(cursor: $0, searchTerm: "")) }
  }

  func library(for artist: Artist) -> ArtistLibraryModel {
    if let existing = artistLibraries[artist.id] { return existing }
    let library = ArtistLibraryModel(artist: artist, source: source)
    artistLibraries[artist.id] = library
    return library
  }
}

@MainActor
@Observable
final class ArtistLibraryModel {
  private(set) var playError: String?
  let songs: PagedLibrary<Track>
  let releases: PagedLibrary<Album>

  init(artist: Artist, source: any MusicSource) {
    songs = PagedLibrary {
      try await source.fetchSongs(SongBrowseRequest(cursor: $0, searchTerm: "", artistID: artist.id))
    }
    releases = PagedLibrary {
      let page = try await source.fetchArtistAlbums(artistID: artist.id, cursor: $0)
      return LibraryPage(items: page.albums, nextCursor: page.nextCursor, totalCount: page.totalCount)
    }
  }

  func play(using player: PlayerStore) async {
    let choice = player.playbackChoiceRevision
    let lifecycle = player.audioLifecycleRevision
    playError = nil
    await songs.open()
    guard !Task.isCancelled else { return }
    if let error = songs.errorText {
      playError = error
      return
    }
    var visited = Set<String>()
    while let cursor = songs.nextCursor {
      guard visited.insert(cursor).inserted else {
        playError = MusicSourceError.invalidCursor.localizedDescription
        return
      }
      await songs.next()
      guard !Task.isCancelled else { return }
      if let error = songs.errorText {
        playError = error
        return
      }
    }
    guard !Task.isCancelled, player.playbackChoiceRevision == choice,
      player.audioLifecycleRevision == lifecycle
    else { return }
    player.play(songs.items)
  }
}
