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
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
      // ArrangementView already proposes a pane that excludes its native rail.
      let usableWidth = max(0, geometry.size.width)
      let contentWidth = max(0, usableWidth - 48)
      // Two 44pt skip targets, the padded 60pt play target, and two 32pt gaps.
      let minimumTransportWidth: CGFloat = 44 * 2 + 60 + 32 * 2
      let isWide = usableWidth > geometry.size.height && !dynamicTypeSize.isAccessibilitySize
      let layout =
        if isWide {
          AnyLayout(HStackLayout(alignment: .center, spacing: 24))
        } else {
          AnyLayout(VStackLayout(spacing: 24))
        }
      ScrollView {
        layout {
          if !dynamicTypeSize.isAccessibilitySize {
            let artworkSize =
              if isWide {
                min(200, min(geometry.size.height - 48, max(0, contentWidth - 24 - minimumTransportWidth)))
              } else {
                min(260, min(contentWidth, geometry.size.height * 0.38))
              }
            artwork(size: artworkSize)
          }
          listeningControls
        }
        .frame(maxWidth: min(contentWidth, isWide ? 760 : 520))
        .frame(width: usableWidth)
        .padding(.vertical, 24)
      }
      .frame(width: usableWidth, alignment: .leading)
    }
  }

  @ViewBuilder
  private func artwork(size: CGFloat) -> some View {
    if let track = playerStore.currentTrack {
      AlbumArtwork(artworkURL: track.artworkURL)
        .frame(width: max(0, size), height: max(0, size))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityHidden(true)
    }
  }

  @ViewBuilder
  private var listeningControls: some View {
    if let track = playerStore.currentTrack {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 6) {
          Text(track.title ?? "Untitled track")
            .font(.title2.bold())
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("player.title")
          Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
            .font(.title3)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("player.artist")
        }
        PlaybackProgressView()
        HStack(spacing: 32) {
          PreviousSongButton(symbolSize: 26)
          PlaybackToggleButton(symbolSize: 32)
            .padding(8)
            .background(.quaternary, in: Circle())
          NextSongButton(symbolSize: 26)
        }
        .frame(maxWidth: .infinity)
        HStack {
          if playerStore.state == .loading { ProgressView().controlSize(.small) }
          Text(playerStore.state.rawValue.capitalized)
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("player.state")
        }
        PlaybackFailureView()
      }
    }
  }
}
