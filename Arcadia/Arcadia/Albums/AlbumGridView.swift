import SwiftUI

struct AlbumGridView: View {

  let albumService: AlbumService

  let countText: String
  let albums: [Album]
  let hasNextPage: Bool
  let isLoadingNextPage: Bool
  let onReachBottom: () async -> Void
  var isInitialLoading = false
  @State private var isList = false
  @State private var descending = false

  private var displayedAlbums: [Album] {
    #if os(macOS)
      albums.sorted {
        descending
          ? $0.title.localizedStandardCompare($1.title) == .orderedDescending
          : $0.title.localizedStandardCompare($1.title) == .orderedAscending
      }
    #else
      albums
    #endif
  }

  var body: some View {
    ScrollView {
      #if os(macOS)
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Albums").font(.largeTitle.bold())
            Text("\(countText) albums").foregroundStyle(.secondary)
              .accessibilityIdentifier("albums.count")
          }
          Spacer()
          Picker("Album layout", selection: $isList) {
            Image(systemName: "square.grid.2x2").tag(false)
            Image(systemName: "list.bullet").tag(true)
          }.pickerStyle(.segmented).labelsHidden().frame(width: 88)
          Menu(descending ? "Z–A" : "A–Z") {
            Text("Sort loaded albums")
            Button("Title (A–Z)") { descending = false }
            Button("Title (Z–A)") { descending = true }
          }
          .accessibilityIdentifier("albums.sort")
        }.padding(.horizontal, 28).padding(.top, 16)
      #else
        Text("\(countText) albums")
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("albums.count")
      #endif
      AlbumCardGrid(isList: isList) {
        if isInitialLoading {
          ForEach(0..<8, id: \.self) { _ in
            AlbumCardView(artworkURL: nil, title: "A familiar record", artist: "An artist", year: "2026")
              .redacted(reason: .placeholder)
              .skeletonPulse()
              .accessibilityHidden(true)
          }
        }
        ForEach(displayedAlbums) { album in
          NavigationLink(value: LibraryRoute.album(album)) {
            #if os(macOS)
              if isList {
                HStack {
                  AlbumArtwork(artworkURL: album.artworkURL).frame(width: 48, height: 48)
                  Text(album.title)
                  Spacer()
                  Text(album.albumArtist).foregroundStyle(.secondary)
                }
              } else {
                AlbumCardView(artworkURL: album.artworkURL, title: album.title, artist: album.albumArtist, year: "")
              }
            #else
              AlbumCardView(
                artworkURL: album.artworkURL, title: album.title, artist: album.albumArtist,
                year: album.year.map(String.init) ?? "")
            #endif
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("album.\(album.id)")
        }

        if hasNextPage {
          VStack(spacing: DesignTokens.Spacing.s) {
            if isLoadingNextPage {
              AlbumCardView(artworkURL: nil, title: "A familiar record", artist: "An artist", year: "2026")
                .redacted(reason: .placeholder)
                .skeletonPulse()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading more albums")
            }
          }
          .task {
            await onReachBottom()
          }
        }
      }
      #if os(macOS)
        .frame(maxWidth: isList ? .infinity : 600)
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
      #endif
      .padding(.horizontal, DesignTokens.Spacing.l)
      .libraryNavigationTitle("Albums")
    }
    .accessibilityIdentifier(isInitialLoading ? "albums.loading" : "albums.scroll")
    .accessibilityLabel(isInitialLoading ? "Loading albums" : "Albums")
  }
}
