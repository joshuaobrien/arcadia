import SwiftUI

#if os(macOS)
  struct MacPlayerBar: View {
    @Environment(PlayerStore.self) private var playerStore
    let showQueue: () -> Void
    let openLibraryRoute: (LibraryRoute) -> Void

    var body: some View {
      if let track = playerStore.currentTrack {
        VStack(spacing: 8) {
          ViewThatFits(in: .horizontal) {
            HStack(spacing: 24) {
              metadata(track).frame(width: 240)
              transport.frame(minWidth: 300, maxWidth: 580)
              trailingControls.frame(width: 180)
            }
            VStack(spacing: 8) {
              HStack(spacing: 16) {
                metadata(track).frame(maxWidth: .infinity, alignment: .leading)
                playbackButtons
                queueButton
              }
              HStack(spacing: 24) {
                PlaybackProgressView()
                volumeControl.frame(width: 140)
              }
            }
          }
          PlaybackFailureView()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .accessibilityElement(children: .contain)
        .accessibilityValue(playerStore.state.rawValue.capitalized)
        .accessibilityIdentifier("player.bar")
      }
    }

    private func metadata(_ track: Track) -> some View {
      HStack(spacing: 14) {
        AlbumArtwork(artworkURL: track.artworkURL)
          .frame(width: 64, height: 64)
          .clipShape(RoundedRectangle(cornerRadius: 8))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 4) {
          Text(track.title ?? "Untitled track")
            .font(.headline)
            .lineLimit(1)
            .help(track.title ?? "Untitled track")
            .accessibilityIdentifier("player.title")
          PlayerMetadataLinks(track: track, open: openLibraryRoute, isCompact: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if playerStore.state == .loading { ProgressView().controlSize(.small) }
      }
    }

    private var transport: some View {
      VStack(spacing: 4) {
        playbackButtons
        PlaybackProgressView()
      }
    }

    private var playbackButtons: some View {
      HStack(spacing: 12) {
        PreviousSongButton(symbolSize: 20)
        PlaybackToggleButton(symbolSize: 24)
        NextSongButton(symbolSize: 20)
      }
      .foregroundStyle(.primary)
    }

    private var trailingControls: some View {
      HStack(spacing: 16) {
        volumeControl
        Divider().frame(height: 28)
        queueButton
      }
    }

    private var queueButton: some View {
      Button(action: showQueue) {
        Image(systemName: "list.bullet")
          .font(.title3)
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Up Next")
      .help("Show Up Next")
      .accessibilityIdentifier("player.up-next")
    }

    private var volumeControl: some View {
      HStack(spacing: 8) {
        Image(systemName: "speaker.wave.2").accessibilityHidden(true)
        Slider(
          value: Binding(get: { playerStore.volume }, set: { playerStore.setVolume($0) }),
          in: 0...1
        )
        .accessibilityLabel("Volume")
        .accessibilityIdentifier("player.volume")
      }
      .foregroundStyle(.secondary)
    }
  }
#endif
