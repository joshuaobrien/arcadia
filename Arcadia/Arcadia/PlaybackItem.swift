import Foundation

struct QueueEntry: Identifiable {
  enum Origin: String, Codable { case collection, manual }

  let id: UUID
  let track: Track
  let origin: Origin

  init(track: Track, origin: Origin = .collection, id: UUID = UUID()) {
    self.id = id
    self.track = track
    self.origin = origin
  }

  func withResolvedMetadata(_ metadata: Track?) -> Self {
    guard let metadata, metadata.stableID == track.stableID else { return self }
    return Self(track: metadata, origin: origin, id: id)
  }
}
