import Foundation

// Grow this existing browsing seam as listening features are implemented.
nonisolated protocol MusicSource: AlbumService {
  func artworkData(for url: URL) async throws -> Data
  func playableResource(for track: Track) async throws -> PlayableResource
  func fetchSongs(_ request: SongBrowseRequest) async throws -> LibraryPage<Track>
  func fetchArtists(_ request: ArtistBrowseRequest) async throws -> LibraryPage<Artist>
  func fetchSearch(_ request: LibrarySearchRequest) async throws -> LibraryPage<LibrarySearchResult>
  func fetchPlaylists(_ request: PlaylistBrowseRequest) async throws -> LibraryPage<Playlist>
  func fetchPlaylistSongs(playlistID: String, cursor: String?) async throws -> LibraryPage<PlaylistSong>
  func fetchArtistAlbums(artistID: String, cursor: String?) async throws -> FetchAlbumsResponse
}

struct ConnectedMusicSource {
  let source: any MusicSource
  let savedSession: Data
}

protocol MusicSourceConnector {
  func connect(server: URL, username: String, password: String) async throws -> ConnectedMusicSource
  func restore(_ session: Data) async throws -> ConnectedMusicSource
}

enum MusicSourceError: LocalizedError {
  case invalidServer
  case credentialsRequired
  case authenticationFailed
  case unavailable
  case invalidResponse
  case invalidCursor
  case storageFailed
  case unsupportedBrowsing

  var errorDescription: String? {
    switch self {
    case .invalidServer: "Enter an HTTP or HTTPS server address without credentials, query or fragment."
    case .credentialsRequired: "Enter your username and password."
    case .authenticationFailed: "Sign-in failed. Check your username and password, then try again."
    case .unavailable: "Couldn't reach the music server. Check the address and connection, then try again."
    case .invalidResponse: "The music server returned an unexpected response. Try again."
    case .invalidCursor: "Couldn't load the next page. Reload the library."
    case .unsupportedBrowsing: "This music source does not support this browsing view."
    case .storageFailed: "Couldn't securely save your connection. Try again."
    }
  }
}

// Resolved access is ephemeral; queues and saved sessions contain song metadata only.
struct PlayableResource {
  let url: URL
}

// Transitional Arcadia API sources retain album browsing until they support the
// richer source contract. Unsupported destinations fail explicitly.
extension MusicSource {
  func fetchSearch(_ input: LibrarySearchRequest) async throws -> LibraryPage<LibrarySearchResult> {
    switch input.category {
    case .songs:
      let page = try await fetchSongs(SongBrowseRequest(cursor: input.cursor, searchTerm: input.query))
      return LibraryPage(items: page.items.map(LibrarySearchResult.song), nextCursor: page.nextCursor)
    case .artists:
      let page = try await fetchArtists(ArtistBrowseRequest(cursor: input.cursor, searchTerm: input.query))
      return LibraryPage(items: page.items.map(LibrarySearchResult.artist), nextCursor: page.nextCursor)
    case .albums:
      let page = try await fetchAlbums(FetchAlbumsRequest(cursor: input.cursor, searchTerm: input.query))
      return LibraryPage(items: page.albums.map(LibrarySearchResult.album), nextCursor: page.nextCursor)
    case .playlists:
      let page = try await fetchPlaylists(PlaylistBrowseRequest(cursor: input.cursor, searchTerm: input.query))
      return LibraryPage(items: page.items.map(LibrarySearchResult.playlist), nextCursor: page.nextCursor)
    }
  }

  func fetchPlaylists(_: PlaylistBrowseRequest) async throws -> LibraryPage<Playlist> {
    throw MusicSourceError.unsupportedBrowsing
  }

  func fetchPlaylistSongs(playlistID _: String, cursor _: String?) async throws -> LibraryPage<PlaylistSong> {
    throw MusicSourceError.unsupportedBrowsing
  }

  func fetchSongs(_: SongBrowseRequest) async throws -> LibraryPage<Track> {
    throw MusicSourceError.unsupportedBrowsing
  }

  func fetchArtists(_: ArtistBrowseRequest) async throws -> LibraryPage<Artist> {
    throw MusicSourceError.unsupportedBrowsing
  }

  func fetchArtistAlbums(artistID _: String, cursor _: String?) async throws -> FetchAlbumsResponse {
    throw MusicSourceError.unsupportedBrowsing
  }
}
