import SwiftUI

struct QueueFeedbackView: View {
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    if let feedback = playerStore.queueFeedback {
      HStack {
        Text(feedback.message)
          .accessibilityIdentifier("queue.feedback")
        Button("Undo") { playerStore.undoAddition(feedback.id) }
          .accessibilityIdentifier("queue.undo")
      }
      .font(.callout)
      .padding(12)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
      .padding()
      .onAppear { AccessibilityNotification.Announcement(feedback.message).post() }
      .onChange(of: feedback.id) { _, _ in AccessibilityNotification.Announcement(feedback.message).post() }
    }
  }
}
