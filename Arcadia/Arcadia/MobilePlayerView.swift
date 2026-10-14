import SwiftUI

struct CompactPlayerView: View {
  @Environment(PlayerStore.self) private var playerStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
              // The native bottom accessory has a compact height. Full-sized metadata
              // remains available in Now Playing and the shared library rows.
              .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
              .accessibilityIdentifier("player.title")
            if !dynamicTypeSize.isAccessibilitySize {
              Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
                .font(.caption).foregroundStyle(.secondary)
            }
          }
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open Now Playing: \(track.title ?? "Untitled track")")
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
  @Binding var queueScrollPosition: ScrollPosition
  @Binding var queueScrollOffset: CGFloat

  var body: some View {
    presentation
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("player.expanded")
  }

  @ViewBuilder
  private var presentation: some View {
    #if os(iOS)
      if #available(iOS 27.1, *) {
        ArrangementView {
          playerContent
            .splitArrangementLayoutSize(minWidth: 300, minHeight: 180)
        } secondary: {
          QueueView(scrollPosition: $queueScrollPosition, scrollOffset: $queueScrollOffset)
            .splitArrangementLayoutSize(minWidth: 280, minHeight: 180)
        }
        .arrangementViewStyle(.split)
      } else {
        playerContent
      }
    #else
      playerContent
    #endif
  }

  private var playerContent: some View {
    GeometryReader { geometry in
      VStack(spacing: 16) {
        if let track = playerStore.currentTrack {
          AlbumArtwork(artworkURL: track.artworkURL)
            .aspectRatio(1, contentMode: .fit)
            .frame(maxHeight: max(0, min(320, geometry.size.height - 180)))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24)
        }
        Spacer(minLength: 0)
        PlayerBar()
      }
      .padding(.top, 16)
    }
  }
}
