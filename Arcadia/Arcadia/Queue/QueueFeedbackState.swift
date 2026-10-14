import Foundation
import Observation

@MainActor
@Observable
final class QueueFeedbackState {
  struct Feedback: Identifiable {
    let id = UUID()
    let message: String
    let entryIDs: Set<UUID>
  }
  private(set) var current: Feedback?
  @ObservationIgnored private var expiry: Task<Void, Never>?

  func show(_ entries: [QueueEntry], message: String) {
    expiry?.cancel()
    let feedback = Feedback(message: message, entryIDs: Set(entries.map(\.id)))
    current = feedback
    expiry = Task { [weak self] in
      try? await Task.sleep(for: .seconds(8))
      guard !Task.isCancelled, let self, self.current?.id == feedback.id else { return }
      self.current = nil
    }
  }

  func clear() {
    expiry?.cancel()
    expiry = nil
    current = nil
  }
}
