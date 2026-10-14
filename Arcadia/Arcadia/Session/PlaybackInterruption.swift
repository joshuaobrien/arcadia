import Foundation

@MainActor
final class PlaybackInterruption {
  private struct SavedIntent {
    let token = UUID()
    let entry: UUID?
    let generation: UUID
    let choice: UUID
    let requested: Bool
  }
  private var saved: SavedIntent?

  func begin(entry: UUID?, generation: UUID, choice: UUID, requested: Bool) -> UUID {
    if let saved { return saved.token }
    let intent = SavedIntent(entry: entry, generation: generation, choice: choice, requested: requested)
    saved = intent
    return intent.token
  }

  func finish(_ token: UUID, entry: UUID?, generation: UUID, choice: UUID) -> Bool {
    guard let intent = saved, intent.token == token else { return false }
    saved = nil
    return intent.requested && intent.entry == entry && intent.generation == generation && intent.choice == choice
  }
}
