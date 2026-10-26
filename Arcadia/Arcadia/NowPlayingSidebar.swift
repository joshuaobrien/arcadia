import SwiftUI

struct NowPlayingSidebar: View {
  @Environment(PlayerStore.self) private var playerStore
  let showQueue: () -> Void
  private let lavender = Color(red: 0.65, green: 0.55, blue: 0.85)

  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        if let track = playerStore.currentTrack {
          VStack(alignment: .leading, spacing: geometry.size.height < 600 ? 12 : 20) {
            HStack {
              Text("NOW PLAYING")
                .font(.caption.weight(.medium))
                .tracking(3)
              Spacer()
              if playerStore.state == .loading { ProgressView().controlSize(.small) }
              Text(playerStore.state.rawValue.capitalized)
                .font(.caption)
                .accessibilityIdentifier("player.state")
            }
            .foregroundStyle(.secondary)
            AlbumArtwork(artworkURL: track.artworkURL)
              .frame(width: artworkSize(in: geometry.size), height: artworkSize(in: geometry.size))
              .clipShape(RoundedRectangle(cornerRadius: 16))
              .overlay {
                RoundedRectangle(cornerRadius: 16).strokeBorder(.primary.opacity(0.15))
              }
              .shadow(color: lavender.opacity(0.2), radius: 24)
              .frame(maxWidth: .infinity)
              .accessibilityHidden(true)
            metadata(track)
            PlaybackProgressView()
              .tint(lavender)
            HStack {
              PreviousSongButton(symbolSize: 24)
              Spacer(minLength: 12)
              PlaybackToggleButton(symbolSize: 28)
                .padding(8)
                .overlay { Circle().strokeBorder(lavender, lineWidth: 2).allowsHitTesting(false) }
              Spacer(minLength: 12)
              NextSongButton(symbolSize: 24)
            }
            .foregroundStyle(.primary)
            volumeControl
            PlaybackFailureView()
            Spacer(minLength: 0)
            Divider()
            Button(action: showQueue) {
              HStack(spacing: 12) {
                Image(systemName: "list.bullet")
                Text("Up Next")
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
              }
              .padding(.vertical, 4)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("player.up-next")
          }
          .padding(24)
          .frame(minHeight: geometry.size.height, alignment: .top)
        }
      }
      .background(alignment: .top) {
        LinearGradient(colors: [lavender.opacity(0.12), .clear], startPoint: .top, endPoint: .bottom)
      }
      .background(.bar)
      .accessibilityIdentifier("player.bar")
    }
  }

  private func artworkSize(in size: CGSize) -> CGFloat {
    min(252, max(80, size.height - 430))
  }

  private func metadata(_ track: Track) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(track.title ?? "Untitled track")
        .font(.title.bold())
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("player.title")
      Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
        .font(.title3)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("player.artist")
      Text(track.albumReference?.title ?? "Unknown Album")
        .font(.body)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("player.album")
    }
  }

  private var volumeControl: some View {
    HStack(spacing: 12) {
      Image(systemName: "speaker.fill").accessibilityHidden(true)
      Slider(
        value: Binding(get: { playerStore.volume }, set: { playerStore.setVolume($0) }),
        in: 0...1
      )
      .tint(lavender)
      .accessibilityLabel("Volume")
      .accessibilityIdentifier("player.volume")
      Image(systemName: "speaker.wave.3.fill").accessibilityHidden(true)
    }
    .foregroundStyle(.secondary)
  }
}
