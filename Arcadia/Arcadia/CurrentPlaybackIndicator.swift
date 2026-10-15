import SwiftUI

struct CurrentPlaybackIndicator: View {
  let state: PlayerStore.State
  let identifier: String

  var body: some View {
    Label(title, systemImage: symbol)
      .font(.caption.weight(.medium))
      .foregroundStyle(.secondary)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Current track")
      .accessibilityValue(title)
      .accessibilityIdentifier(identifier)
  }

  private var title: String {
    switch state {
    case .playing: "Playing"
    case .paused: "Paused"
    case .loading: "Loading"
    case .failed: "Playback failed"
    case .ended: "Finished"
    case .idle: "Selected"
    }
  }

  private var symbol: String {
    switch state {
    case .playing: "waveform"
    case .paused: "pause.fill"
    case .loading: "hourglass"
    case .failed: "exclamationmark.triangle"
    case .ended: "checkmark.circle"
    case .idle: "circle.inset.filled"
    }
  }
}
