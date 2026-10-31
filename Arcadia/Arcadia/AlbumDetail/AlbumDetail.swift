import SwiftUI

struct AlbumDetail: View {
  @Environment(PlayerStore.self) private var playerStore
  @State private var model: AlbumDetailModel
  private var album: Album

  init(
    albumService: AlbumService,
    album: Album,
  ) {
    _model = State(
      initialValue: .init(albumService: albumService, album: album)
    )
    self.album = album
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        albumHeader

        Divider()

        if model.isLoading {
          LibrarySkeleton(
            layout: .tracks, count: min(album.trackCount ?? 6, 12),
            label: "Loading tracks", identifier: "tracks.loading")
        } else if let errorText = model.errorText {
          ContentUnavailableView(
            "Couldn't Load Tracks",
            systemImage: "exclamationmark.triangle",
            description: Text(errorText)
          )
          .accessibilityIdentifier("tracks.error")
        } else {
          LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
            ForEach(model.tracks) { track in
              TrackRow(track: track)
            }
          }
          .accessibilityIdentifier("tracks.loaded")
        }
      }
      #if os(macOS)
        .padding(28)
      #else
        .padding()
      #endif
    }
    #if os(macOS)
      .background(alignment: .top) {
        LinearGradient(
          colors: [DesignTokens.Desktop.accent.opacity(0.12), .clear], startPoint: .top, endPoint: .bottom
        )
        .frame(height: 400)
        .allowsHitTesting(false)
      }
    #endif
    .accessibilityIdentifier("album.detail.scroll")
    .libraryNavigationTitle(album.title)
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .navigationBarBackButtonHidden(true)
    .toolbar {
      ToolbarItem(placement: .navigation) { AlbumBackButton() }
    }
    .task {
      await model.onOpen()
    }
  }

  @ViewBuilder
  private var albumHeader: some View {
    #if os(macOS)
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .center, spacing: 28) {
          albumArtwork.frame(width: 260, height: 260)
          VStack(alignment: .leading, spacing: 28) {
            albumMetadata
            albumActions
          }
          .frame(minWidth: 240, maxWidth: .infinity, alignment: .leading)
        }
        VStack(alignment: .leading, spacing: 20) {
          albumArtwork.frame(width: 180, height: 180)
          albumMetadata
          albumActions
        }
      }
      .padding(.bottom, 12)
    #else
      AlbumMetadataView(
        artworkURL: album.artworkURL, title: album.title, artist: album.albumArtist,
        year: album.year.map(String.init) ?? "", trackCount: album.trackCount.map(String.init) ?? ""
      )
      albumActions
    #endif
  }

  #if os(macOS)
    private var albumArtwork: some View {
      AlbumArtwork(artworkURL: album.artworkURL)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
    }

    private var albumMetadata: some View {
      AlbumMetadataView(
        artworkURL: album.artworkURL, title: album.title, artist: album.albumArtist,
        year: album.year.map(String.init) ?? "", trackCount: album.trackCount.map(String.init) ?? "",
        showsArtwork: false, summary: albumSummary
      )
    }

    private var albumSummary: String? {
      guard !model.isLoading, model.errorText == nil, !model.tracks.isEmpty else { return nil }
      let count = "\(model.tracks.count) songs"
      let durations = model.tracks.compactMap(\.durationSeconds)
      guard durations.count == model.tracks.count, durations.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
        return count
      }
      let totalMinutes = (durations.reduce(0, +) / 60).rounded(.up)
      guard totalMinutes.isFinite, totalMinutes < Double(Int.max) else { return count }
      let minutes = Int(totalMinutes)
      return "\(count) · \(minutes) minutes"
    }
  #endif

  private var albumActions: some View {
    HStack(spacing: actionSpacing) {
      Button {
        playerStore.play(model.tracks)
      } label: {
        #if os(macOS)
          Label("Play", systemImage: "play.fill").frame(minWidth: 88)
        #else
          Label("Play album", systemImage: "play.fill")
        #endif
      }
      #if os(macOS)
        .buttonStyle(.borderedProminent)
      #endif
      .accessibilityLabel("Play album")
      .accessibilityIdentifier("album.play")
      #if os(macOS)
        Button {
          playerStore.play(model.tracks.shuffled())
        } label: {
          Label("Shuffle", systemImage: "shuffle").frame(minWidth: 88)
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("Shuffle album")
        .accessibilityIdentifier("album.shuffle")
      #endif
      Menu {
        Button("Play Album Next") { playerStore.insertNext(model.tracks) }
        Button("Add Album to Queue") { playerStore.append(model.tracks) }
      } label: {
        Image(systemName: "ellipsis")
      }
      .songMenuStyle()
      .frame(width: 28)
      .accessibilityLabel("Album actions")
      .accessibilityIdentifier("album.actions")
    }
    #if os(macOS)
      .controlSize(.large)
    #endif
    .disabled(model.isLoading || model.tracks.isEmpty)
  }

  private var actionSpacing: CGFloat? {
    #if os(macOS)
      return 12
    #else
      return nil
    #endif
  }
}

private struct AlbumBackButton: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    Button {
      dismiss()
    } label: {
      Label("Back to albums", systemImage: "chevron.left")
    }
    .accessibilityIdentifier("albums.back")
  }
}
