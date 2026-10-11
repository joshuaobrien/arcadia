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
}
