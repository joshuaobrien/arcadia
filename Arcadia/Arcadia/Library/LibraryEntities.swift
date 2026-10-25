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
  // Total matching this request, including items on pages not yet loaded.
  let totalCount: Int?

  init(items: [Item], nextCursor: String?, totalCount: Int? = nil) {
    self.items = items
    self.nextCursor = nextCursor
    self.totalCount = totalCount
  }
}

// Unknown totals stay visibly incomplete until the final page arrives.
func libraryCountText(total: Int?, loaded: Int, hasMore: Bool) -> String {
  if let total { return String(total) }
  return "\(loaded)\(hasMore ? "+" : "")"
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
