import Foundation

struct Playlist: Identifiable, Hashable {
  let id: String
  let title: String
  let artworkURL: URL?
}

struct PlaylistSong: Identifiable {
  let id: String
  let track: Track
}

struct PlaylistBrowseRequest {
  let cursor: String?
  let searchTerm: String
}
