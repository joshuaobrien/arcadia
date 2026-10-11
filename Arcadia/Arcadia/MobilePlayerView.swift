import SwiftUI

struct CompactPlayerView: View {
  @Environment(PlayerStore.self) private var playerStore
  let expand: () -> Void

  var body: some View {
    if let track = playerStore.currentTrack {
      HStack(spacing: 12) {
        AlbumArtwork(artworkURL: track.artworkURL)
          .frame(width: 40, height: 40)
          .clipShape(RoundedRectangle(cornerRadius: 6))
        Button(action: expand) {
          VStack(alignment: .leading, spacing: 2) {
            Text(track.title ?? "Untitled track")
              .font(.subheadline.weight(.semibold))
              .accessibilityIdentifier("player.title")
            Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
              .font(.caption).foregroundStyle(.secondary)
          }
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open Now Playing")
        .accessibilityIdentifier("player.expand")
        PlaybackToggleButton()
        NextSongButton()
      }
      .padding(.horizontal)
      .padding(.vertical, 6)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("player.bar")
    }
  }
}

struct ExpandedPlayerView: View {
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    VStack(spacing: 24) {
      if let track = playerStore.currentTrack {
        AlbumArtwork(artworkURL: track.artworkURL)
          .aspectRatio(1, contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: 16))
          .padding(.horizontal, 24)
          .padding(.top, 24)
      }
      Spacer(minLength: 0)
      PlayerBar()
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("player.expanded")
  }
}
