import SwiftUI

struct PlayerBar: View {
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    if let track = playerStore.currentTrack {
      VStack(spacing: DesignTokens.Spacing.s) {
        HStack(spacing: DesignTokens.Spacing.m) {
          PreviousSongButton()
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
        PlaybackFailureView()
        PlaybackProgressView()
      }
      .padding()
      .background(.bar)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("player.bar")
    }
  }
}

struct PlaybackFailureView: View {
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    if let error = playerStore.errorText {
      HStack {
        Text(error).accessibilityIdentifier("player.error")
        Button("Retry") { playerStore.retry() }.accessibilityIdentifier("player.retry")
      }
      .font(.caption)
    }
  }
}

struct PlaybackProgressView: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(PlayerStore.self) private var playerStore
  @State private var isScrubbing = false
  @State private var scrubPosition = 0.0
  @State private var resumedAfterScrubbing = false

  var body: some View {
    let displayed = isScrubbing ? scrubPosition : playerStore.currentTime
    return Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(spacing: DesignTokens.Spacing.s) {
          HStack {
            elapsedTime(displayed)
            Spacer()
            totalTime
          }
          seekControl(displayed: displayed)
        }
      } else {
        HStack(spacing: DesignTokens.Spacing.m) {
          elapsedTime(displayed)
          seekControl(displayed: displayed)
          totalTime
        }
      }
    }
    .font(.caption.monospacedDigit())
    .foregroundStyle(.secondary)
  }

  private func elapsedTime(_ displayed: Double) -> some View {
    Text(formatTime(displayed))
      .frame(minWidth: 42, alignment: .trailing)
      .fixedSize(horizontal: true, vertical: false)
      .accessibilityIdentifier("player.elapsed")
  }

  private var totalTime: some View {
    Text(formatTime(playerStore.duration))
      .frame(minWidth: 42, alignment: .leading)
      .fixedSize(horizontal: true, vertical: false)
      .accessibilityIdentifier("player.duration")
  }

  private func seekControl(displayed: Double) -> some View {
    Slider(
      value: Binding(
        get: { displayed / max(playerStore.duration, 1) },
        set: { fraction in
          let value = fraction * max(playerStore.duration, 1)
          scrubPosition = value
          if !isScrubbing {
            playerStore.seek(to: value, resumeAfterSeeking: playerStore.isPlaybackRequested)
          }
        }), in: 0...1,
      onEditingChanged: { isEditing in
        if isEditing {
          scrubPosition = playerStore.currentTime
          resumedAfterScrubbing = playerStore.isPlaybackRequested
          isScrubbing = true
          playerStore.pause()
        } else if isScrubbing {
          playerStore.seek(to: scrubPosition, resumeAfterSeeking: resumedAfterScrubbing)
          isScrubbing = false
        }
      }
    )
    .disabled(playerStore.duration <= 0 || playerStore.state == .failed)
    .accessibilityLabel("Playback position")
    .accessibilityIdentifier("player.seek")
  }

  private func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite else { return "0:00" }
    let total = max(0, Int(seconds.rounded()))
    return String(format: "%d:%02d", total / 60, total % 60)
  }
}

struct PlaybackToggleButton: View {
  @Environment(PlayerStore.self) private var playerStore
  var symbolSize: CGFloat = 20
  var body: some View {
    Button {
      playerStore.togglePlayback()
    } label: {
      Image(systemName: playerStore.isPlaybackRequested ? "pause.fill" : "play.fill")
        .font(.system(size: symbolSize))
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
  var symbolSize: CGFloat = 20
  var body: some View {
    Button {
      playerStore.playNext()
    } label: {
      Image(systemName: "forward.end.fill")
        .font(.system(size: symbolSize))
        .frame(minWidth: 44, minHeight: 44)
    }
    .buttonStyle(.borderless)
    .disabled(!playerStore.canAdvance)
    .accessibilityLabel("Next song")
    .accessibilityIdentifier("player.next")
  }
}

struct PreviousSongButton: View {
  @Environment(PlayerStore.self) private var playerStore
  var symbolSize: CGFloat = 20
  var body: some View {
    Button {
      playerStore.playPrevious()
    } label: {
      Image(systemName: "backward.end.fill")
        .font(.system(size: symbolSize))
        .frame(minWidth: 44, minHeight: 44)
    }
    .buttonStyle(.borderless)
    .disabled(playerStore.currentEntryID == nil)
    .accessibilityLabel("Previous song or restart")
    .help("Restart this song, or return to the previous song near the beginning")
    .accessibilityIdentifier("player.previous")
  }
}
