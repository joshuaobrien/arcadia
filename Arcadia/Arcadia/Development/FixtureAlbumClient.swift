#if DEBUG
  import Foundation

  actor FixtureAlbumClient: MusicSource {
    private let scenario: AppConfiguration.FixtureScenario
    private var albumRequests = 0
    private var libraryRequests: [String: Int] = [:]

    init(scenario: AppConfiguration.FixtureScenario) {
      self.scenario = scenario
    }

    func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
      if !request.searchTerm.isEmpty {
        try await libraryRequest(key: "search.albums.\(request.searchTerm)")
        let records = scenario == .empty ? [] : albums(1...(scenario == .twoPage ? 24 : 1))
        let matches = records.filter { $0.title.localizedCaseInsensitiveContains(request.searchTerm) }
        let page = try libraryPage(matches, cursor: request.cursor)
        return FetchAlbumsResponse(albums: page.items, nextCursor: page.nextCursor, totalCount: page.totalCount)
      }
      if scenario == .loading { try await Task.sleep(for: .seconds(60)) }
      if scenario == .delayedLibrary { try await Task.sleep(for: .seconds(2)) }
      AppDiagnostics.event("albums.request")
      albumRequests += 1
      if scenario == .failure || (scenario == .failureThenSuccess && albumRequests == 1) {
        throw FixtureError.requestFailed
      }
      if scenario == .empty { return FetchAlbumsResponse(albums: [], nextCursor: nil, totalCount: 0) }
      if scenario == .twoPage {
        if let cursor = request.cursor {
          guard cursor == "page-2" else { throw FixtureError.invalidCursor }
          return FetchAlbumsResponse(albums: albums(21...24), nextCursor: nil, totalCount: 24)
        }
        return FetchAlbumsResponse(albums: albums(1...20), nextCursor: "page-2", totalCount: 24)
      }
      let records = albums(1...(scenario == .longAlbumMetadata ? 2 : 1))
      return FetchAlbumsResponse(albums: records, nextCursor: nil, totalCount: records.count)
    }

    func fetchAlbum(_ request: FetchAlbumRequest) async throws -> FetchAlbumResponse {
      if scenario == .loading { try await Task.sleep(for: .seconds(60)) }
      if scenario == .delayedLibrary { try await Task.sleep(for: .seconds(2)) }
      AppDiagnostics.event("tracks.request")
      guard request.albumId.hasPrefix("fixture-") else { throw FixtureError.invalidAlbum }
      return FetchAlbumResponse(
        total: 3,
        items: (1...3).map { number in
          Track(
            id: "\(request.albumId)-track-\(number)", relativePath: nil,
            title: ["The First Song", "The Second Song", "The Third Song"][number - 1],
            artists: ["Bjork"], trackNumber: number, discNumber: 1, durationSeconds: 63, format: "MP3"
          )
        },
        nextCursor: nil
      )
    }

    func fetchSongs(_ request: SongBrowseRequest) async throws -> LibraryPage<Track> {
      if scenario == .pagedSearchFailure, request.cursor != nil, !request.searchTerm.isEmpty {
        let key = "later-search.\(request.searchTerm)"
        libraryRequests[key, default: 0] += 1
        if libraryRequests[key] == 1 { throw FixtureError.requestFailed }
      }
      if scenario == .delayedSearch && request.searchTerm == "First" {
        await Task.detached { try? await Task.sleep(for: .seconds(3)) }.value
      }
      try await libraryRequest(key: "songs.\(request.artistID ?? "all").\(request.searchTerm)")
      if scenario == .empty { return LibraryPage(items: [], nextCursor: nil, totalCount: 0) }
      var records: [Track]
      if let artistID = request.artistID {
        if artistID == "fixture-artist-credit" {
          records = [librarySong(number: 1, artistNumber: 1)]
        } else {
          let number = Int(artistID.replacingOccurrences(of: "fixture-artist-", with: "")) ?? 1
          records = (1...6).map { librarySong(number: $0, artistNumber: number) }
        }
      } else {
        records = (1...((scenario == .twoPage || scenario == .pagedSearchFailure) ? 24 : 3)).map {
          librarySong(number: $0, artistNumber: 1)
        }
      }
      if !request.searchTerm.isEmpty {
        records = records.filter { ($0.title ?? "").localizedCaseInsensitiveContains(request.searchTerm) }
      }
      return try libraryPage(records, cursor: request.cursor)
    }

    func fetchArtists(_ request: ArtistBrowseRequest) async throws -> LibraryPage<Artist> {
      try await libraryRequest(key: "artists.\(request.searchTerm)")
      if scenario == .empty { return LibraryPage(items: [], nextCursor: nil, totalCount: 0) }
      var records = (1...(scenario == .twoPage ? 24 : 1)).map { fixtureArtist($0) }
      if !request.searchTerm.isEmpty {
        records = records.filter { $0.name.localizedCaseInsensitiveContains(request.searchTerm) }
      }
      return try libraryPage(records, cursor: request.cursor)
    }

    func fetchArtistAlbums(artistID: String, cursor: String?) async throws -> FetchAlbumsResponse {
      try await libraryRequest(key: "releases.\(artistID)")
      if scenario == .empty || artistID == "fixture-artist-credit" {
        return FetchAlbumsResponse(albums: [], nextCursor: nil, totalCount: 0)
      }
      let records = try libraryPage(albums(1...2), cursor: cursor)
      return FetchAlbumsResponse(albums: records.items, nextCursor: records.nextCursor, totalCount: records.totalCount)
    }

    func fetchPlaylists(_ request: PlaylistBrowseRequest) async throws -> LibraryPage<Playlist> {
      try await libraryRequest(key: "playlists.\(request.searchTerm)")
      if scenario == .empty { return LibraryPage(items: [], nextCursor: nil, totalCount: 0) }
      let records = (1...(scenario == .twoPage ? 24 : 2)).map {
        Playlist(id: "fixture-playlist-\($0)", title: $0 == 1 ? "Fixture Mix" : "Fixture Empty", artworkURL: nil)
      }.filter { request.searchTerm.isEmpty || $0.title.localizedCaseInsensitiveContains(request.searchTerm) }
      return try libraryPage(records, cursor: request.cursor)
    }

    func fetchPlaylistSongs(playlistID: String, cursor: String?) async throws -> LibraryPage<PlaylistSong> {
      if scenario == .pagedPlaylistFailure, cursor != nil {
        let key = "later-playlist.\(playlistID)"
        libraryRequests[key, default: 0] += 1
        if libraryRequests[key] == 1 { throw FixtureError.requestFailed }
      }
      try await libraryRequest(key: "playlist.\(playlistID)")
      if playlistID == "fixture-playlist-2" || scenario == .empty {
        return LibraryPage(items: [], nextCursor: nil, totalCount: 0)
      }
      let order = Array(
        repeating: [2, 1, 2, 3], count: (scenario == .twoPage || scenario == .pagedPlaylistFailure) ? 6 : 1
      ).flatMap { $0 }
      let records = order.enumerated().map {
        PlaylistSong(id: "fixture-occurrence-\($0.offset + 1)", track: librarySong(number: $0.element, artistNumber: 1))
      }
      return try libraryPage(records, cursor: cursor)
    }

    private func libraryRequest(key: String) async throws {
      if scenario == .loading { try await Task.sleep(for: .seconds(60)) }
      if scenario == .delayedPlaylist && key.hasPrefix("playlist.") { try await Task.sleep(for: .seconds(4)) }
      if scenario == .delayedLibrary {
        // Keep artist-song placeholders visible through XCTest's geometry queries and capture.
        try await Task.sleep(for: .seconds(key.hasPrefix("songs.fixture-artist-") ? 6 : 2))
      }
      libraryRequests[key, default: 0] += 1
      if scenario == .failure || (scenario == .failureThenSuccess && libraryRequests[key] == 1) {
        throw FixtureError.requestFailed
      }
    }

    private func libraryPage<Item>(_ items: [Item], cursor: String?) throws -> LibraryPage<Item> {
      let offset: Int
      if let cursor {
        guard let value = Int(cursor), value >= 0, value <= items.count else { throw FixtureError.invalidCursor }
        offset = value
      } else {
        offset = 0
      }
      let end = min(offset + 20, items.count)
      return LibraryPage(
        items: Array(items[offset..<end]), nextCursor: end < items.count ? String(end) : nil, totalCount: items.count)
    }

    private func fixtureArtist(_ number: Int) -> Artist {
      Artist(id: "fixture-artist-\(number)", name: number == 1 ? "Bjork" : "Fixture Artist \(number)", artworkURL: nil)
    }

    private func librarySong(number: Int, artistNumber: Int) -> Track {
      let albumNumber = (number - 1) / 3 + 1
      let trackNumber = (number - 1) % 3 + 1
      let artist = fixtureArtist(artistNumber)
      let albumTitle = albumNumber == 1 ? "Hyperballad" : "Fixture Album \(albumNumber)"
      let artwork = number == 3 ? nil : Bundle.main.url(forResource: "FixtureArtwork", withExtension: "png")
      return Track(
        id: "fixture-\(albumNumber)-track-\(trackNumber)", relativePath: nil,
        title: albumNumber == 1
          ? ["The First Song", "The Second Song", "The Third Song"][trackNumber - 1] : "Fixture Song \(number)",
        artists: [artist.name], trackNumber: trackNumber, discNumber: 1, durationSeconds: 63, format: "MP3",
        albumReference: AlbumReference(
          id: "fixture-\(albumNumber)", title: albumTitle, artworkURL: artwork, albumArtist: artist.name),
        artistReferences: [artist], artworkURL: artwork)
    }

    func playableResource(for track: Track) async throws -> PlayableResource {
      if scenario == .playbackFailure {
        return PlayableResource(url: URL(fileURLWithPath: "/missing-arcadia-fixture-audio.wav"))
      }
      if scenario == .delayedPlayback && track.trackNumber == 1 {
        try await Task.sleep(for: .seconds(2))
      }
      return PlayableResource(url: try FixtureAudio.url(for: track))
    }

    func artworkData(for url: URL) async throws -> Data {
      guard url.isFileURL else { throw FixtureError.requestFailed }
      return try Data(contentsOf: url)
    }

    private func albums(_ numbers: ClosedRange<Int>) -> [Album] {
      numbers.map { number in
        Album(
          id: "fixture-\(number)",
          title: scenario == .longAlbumMetadata && number == 1
            ? "The Extraordinary Adventures of a Very Long Album Title"
            : (number == 1 ? "Hyperballad" : "Fixture Album \(number)"),
          albumArtist: scenario == .longAlbumMetadata
            ? "The Northern Lights Orchestra with The Evening Choir" : "Bjork", year: 1996, trackCount: 3,
          artworkURL: Bundle.main.url(forResource: "FixtureArtwork", withExtension: "png")
        )
      }
    }
  }

  private enum FixtureError: LocalizedError {
    case requestFailed
    case invalidCursor
    case invalidAlbum

    var errorDescription: String? {
      switch self {
      case .requestFailed: "Fixture request failed."
      case .invalidCursor: "Unexpected fixture cursor."
      case .invalidAlbum: "Unexpected fixture album."
      }
    }
  }
#endif
