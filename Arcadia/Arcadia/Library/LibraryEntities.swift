import Foundation

struct Artist: Codable, Identifiable, Hashable {
  let id: String
  let name: String
  let artworkURL: URL?
}

struct AlbumReference: Codable, Identifiable, Hashable {
  let id: String
  let title: String
  let artworkURL: URL?

  let albumArtist: String?

  func album() -> Album {
    Album(
      id: id, title: title, albumArtist: albumArtist ?? "Unknown Artist", year: nil, trackCount: nil,
      artworkURL: artworkURL)
  }
}

struct LibraryPage<Item> {
  let items: [Item]
  let nextCursor: String?
}

struct SongBrowseRequest {
  let cursor: String?
  let searchTerm: String
  var artistID: String?
}

struct ArtistBrowseRequest {
  let cursor: String?
  let searchTerm: String
}
