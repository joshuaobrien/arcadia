import SwiftUI

/// Uses the real row/card composition so loading reserves the same content space.
struct LibrarySkeleton: View {
  enum Layout { case songs, tracks, artists, playlists, albums, albumResults, searchLinks }
  var layout: Layout = .songs
  var count = 6
  var showsDividers = false
  var label = "Loading songs"
  var identifier = "songs.loading"

  var body: some View {
    Group {
      if layout == .albums {
        AlbumCardGrid { placeholders }
      } else {
        VStack(alignment: .leading, spacing: layout == .tracks ? DesignTokens.Spacing.s : DesignTokens.Spacing.m) {
          placeholders
        }
      }
    }
    .skeletonPulse()
    .allowsHitTesting(false)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityIdentifier(identifier)
  }

  private var placeholders: some View {
    ForEach(0..<count, id: \.self) { _ in
      VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        switch layout {
        case .songs, .tracks:
          TrackRow(track: Self.track, showsTrackNumber: layout == .tracks)
        case .artists, .playlists:
          HStack(spacing: layout == .artists ? DesignTokens.Spacing.l : DesignTokens.Spacing.s) {
            RoundedRectangle(cornerRadius: layout == .artists ? 24 : 0)
              .fill(.quaternary).frame(width: 48, height: 48)
            Text("A familiar artist").font(.headline)
            Spacer()
            Image(systemName: "chevron.right")
          }
          .padding(.vertical, 4)
        case .albums, .albumResults:
          AlbumCardView(artworkURL: nil, title: "A familiar record", artist: "An artist", year: "2026")
            .frame(width: layout == .albumResults ? 180 : nil)
        case .searchLinks:
          Label("A matching result", systemImage: "music.note")
        }
        if showsDividers { Divider() }
      }
    }
    .redacted(reason: .placeholder)
    .disabled(true)
  }

  private static let track = Track(
    id: "loading", relativePath: nil, title: "A familiar song", artists: ["An artist"],
    trackNumber: 1, discNumber: 1, durationSeconds: 180, format: "FLAC",
    albumReference: AlbumReference(
      id: "loading", title: "A familiar record", artworkURL: nil, albumArtist: "An artist"),
    artistReferences: [Artist(id: "loading", name: "An artist", artworkURL: nil)]
  )
}

private struct SkeletonPulse: ViewModifier {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var dimmed = false

  func body(content: Content) -> some View {
    content
      .opacity(reduceMotion ? 1 : (dimmed ? 0.45 : 0.85))
      .animation(reduceMotion ? nil : .easeInOut(duration: 1).repeatForever(autoreverses: true), value: dimmed)
      .onAppear { dimmed = true }
  }
}

extension View {
  func skeletonPulse() -> some View { modifier(SkeletonPulse()) }
}
