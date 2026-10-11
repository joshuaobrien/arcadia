import Foundation

// Deliberate whitelist: resource URLs and secure source-session bytes never enter this file.
struct PlaybackSnapshot: Codable {
  let version: Int
  let sourceBinding: UUID
  let entries: [Entry]
  let currentEntryID: UUID?
  let position: Double

  struct Entry: Codable {
    let id: UUID
    let origin: QueueEntry.Origin
    let song: Song

    init(_ entry: QueueEntry) {
      id = entry.id
      origin = entry.origin
      song = Song(entry.track)
    }

    var queueEntry: QueueEntry { QueueEntry(track: song.track, origin: origin, id: id) }
  }

  struct Song: Codable {
    let id: String
    let title: String?
    let artists: [String]?
    let trackNumber: Int?
    let discNumber: Int?
    let duration: Double?
    let format: String?
    let albumID: String?
    let albumTitle: String?
    let albumArtist: String?

    init(_ track: Track) {
      id = track.id
      title = track.title
      artists = track.artists
      trackNumber = track.trackNumber
      discNumber = track.discNumber
      duration = track.durationSeconds.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
      format = track.format
      albumID = track.albumReference?.id
      albumTitle = track.albumReference?.title
      albumArtist = track.albumReference?.albumArtist
    }

    var track: Track {
      let album = albumID.flatMap { id in
        albumTitle.map { AlbumReference(id: id, title: $0, artworkURL: nil, albumArtist: albumArtist) }
      }
      return Track(id: id, relativePath: nil, title: title, artists: artists,
        trackNumber: trackNumber, discNumber: discNumber, durationSeconds: duration, format: format,
        albumReference: album, artistReferences: nil, artworkURL: nil)
    }
  }

  func validate(binding: UUID) throws {
    guard sourceBinding == binding else { throw PlaybackSessionError.differentSource }
    guard version == 1, position.isFinite, position >= 0,
      Set(entries.map(\.id)).count == entries.count,
      entries.allSatisfy({ !$0.song.id.isEmpty }),
      currentEntryID.map({ id in entries.contains { $0.id == id } }) ?? (position == 0)
    else { throw PlaybackSessionError.invalidSnapshot }
  }
}

enum PlaybackSessionError: LocalizedError {
  case differentSource, invalidSnapshot

  var errorDescription: String? {
    switch self {
    case .differentSource: "Your saved listening session belongs to another music connection."
    case .invalidSnapshot: "Your saved listening session couldn't be read. You can start a new queue."
    }
  }
}
