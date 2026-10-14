import SwiftUI

struct PlayerBar: View {
  @Environment(PlayerStore.self) private var playerStore
  @State private var isScrubbing = false
  @State private var scrubPosition = 0.0
  @State private var resumedAfterScrubbing = false

  var body: some View {
    if let track = playerStore.currentTrack {
      VStack(spacing: DesignTokens.Spacing.s) {
        HStack(spacing: DesignTokens.Spacing.m) {
          PlaybackToggleButton()
          NextSongButton()
          VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(track.title ?? "Untitled track")
              .font(.headline)
              .lineLimit(1)
              .accessibilityIdentifier("player.title")
            Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Spacer()
          if playerStore.state == .loading { ProgressView().controlSize(.small) }
          Text(playerStore.state.rawValue.capitalized)
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("player.state")
        }
        if let error = playerStore.errorText {
          HStack {
            Text(error).accessibilityIdentifier("player.error")
            Button("Retry") { playerStore.retry() }.accessibilityIdentifier("player.retry")
          }
          .font(.caption)
        }
        progress
      }
      .padding()
      .background(.bar)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("player.bar")
    }
  }

  private var progress: some View {
    let displayed = isScrubbing ? scrubPosition : playerStore.currentTime
    return HStack(spacing: DesignTokens.Spacing.m) {
      Text(formatTime(displayed))
        .frame(width: 42, alignment: .trailing)
        .accessibilityIdentifier("player.elapsed")
      Slider(
        value: Binding(get: { displayed }, set: { scrubPosition = $0 }), in: 0...max(playerStore.duration, 1),
        onEditingChanged: { isEditing in
          if isEditing {
            scrubPosition = playerStore.currentTime
            resumedAfterScrubbing = playerStore.isPlaybackRequested
            isScrubbing = true
            playerStore.pause()
          } else {
            playerStore.seek(to: scrubPosition, resumeAfterSeeking: resumedAfterScrubbing)
            isScrubbing = false
          }
        }
      )
      .disabled(playerStore.duration <= 0 || playerStore.state == .failed)
      .accessibilityLabel("Playback position")
      .accessibilityIdentifier("player.seek")
      Text(formatTime(playerStore.duration))
        .frame(width: 42, alignment: .leading)
        .accessibilityIdentifier("player.duration")
    }
    .font(.caption.monospacedDigit())
    .foregroundStyle(.secondary)
  }

  private func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite else { return "0:00" }
    let total = max(0, Int(seconds.rounded()))
    return String(format: "%d:%02d", total / 60, total % 60)
  }
}

struct PlaybackToggleButton: View {
  @Environment(PlayerStore.self) private var playerStore
  var body: some View {
    Button {
      playerStore.togglePlayback()
    } label: {
      Image(systemName: playerStore.isPlaybackRequested ? "pause.fill" : "play.fill")
        .font(.system(size: 20))
        .frame(minWidth: 44, minHeight: 44)
    }
    .buttonStyle(.borderless)
    .disabled(playerStore.state == .failed)
    .accessibilityLabel(playerStore.isPlaybackRequested ? "Pause" : "Resume")
    .accessibilityIdentifier(playerStore.isPlaybackRequested ? "player.pause" : "player.resume")
  }
}

struct NextSongButton: View {
  @Environment(PlayerStore.self) private var playerStore
  var body: some View {
    Button {
      playerStore.playNext()
    } label: {
      Image(systemName: "forward.end.fill")
        .font(.system(size: 20))
        .frame(minWidth: 44, minHeight: 44)
    }
    .buttonStyle(.borderless)
    .disabled(!playerStore.canAdvance)
    .accessibilityLabel("Next song")
    .accessibilityIdentifier("player.next")
  }
}
