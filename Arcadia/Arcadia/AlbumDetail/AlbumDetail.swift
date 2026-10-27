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
        AlbumMetadataView(
          artworkURL: album.artworkURL,
          title: album.title,
          artist: album.albumArtist,
          year: album.year.map(String.init) ?? "",
          trackCount: album.trackCount.map(String.init) ?? ""
        )

        HStack {
          Button("Play album", systemImage: "play.fill") { playerStore.play(model.tracks) }
            .accessibilityIdentifier("album.play")
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
        .disabled(model.isLoading || model.tracks.isEmpty)

        Divider()
        #if os(macOS)
          HStack(spacing: 24) {
            Text("#").frame(width: 36, alignment: .leading)
            Text("Title")
            Spacer()
            Text("Time").frame(width: 42, alignment: .trailing)
            Spacer().frame(width: 28)
          }.foregroundStyle(.secondary).font(.subheadline)
        #endif

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
      .padding()
    }
    .accessibilityIdentifier("album.detail.scroll")
    .libraryNavigationTitle(album.title)
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .navigationBarBackButtonHidden(true)
    #if os(iOS)
      .toolbar {
        ToolbarItem(placement: .navigation) { AlbumBackButton() }
      }
    #endif
    .task {
      await model.onOpen()
    }
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
