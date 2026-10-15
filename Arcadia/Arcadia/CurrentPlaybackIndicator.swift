import SwiftUI

struct CurrentPlaybackIndicator: View {
  let state: PlayerStore.State
  let identifier: String

  var body: some View {
    let presentation = statusPresentation
    return Label(presentation.title, systemImage: presentation.symbol)
      .font(.caption.weight(.medium))
      .foregroundStyle(.secondary)
      .accessibilityElement(children: .ignore)
      .accessibilityAddTraits(.isStaticText)
      .accessibilityLabel("Current track")
      .accessibilityValue(presentation.title)
      .accessibilityIdentifier(identifier)
  }

  private var statusPresentation: (title: String, symbol: String) {
    switch state {
    case .playing: ("Playing", "waveform")
    case .paused: ("Paused", "pause.fill")
    case .loading: ("Loading", "hourglass")
    case .failed: ("Playback failed", "exclamationmark.triangle")
    case .ended: ("Finished", "checkmark.circle")
    case .idle: ("Selected", "circle.inset.filled")
    }
  }
}
