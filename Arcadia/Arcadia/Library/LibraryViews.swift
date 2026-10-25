import SwiftUI

enum LibraryRoute: Hashable {
  case artist(Artist)
  case album(Album)
  case playlist(Playlist)
}

struct SongsView: View {
  @Bindable var model: PagedLibrary<Track>
  var isActive = true

  var body: some View {
    ScrollView {
      Text("\(model.isLoading && model.items.isEmpty ? "…" : model.countText) songs")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("songs.count")
      LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        ForEach(model.items) { track in
          VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
            TrackRow(track: track, showsTrackNumber: false)
            Divider()
          }
          .id(track.id)
        }
        LibraryPageStatus(model: model, noun: "songs")
      }
      .scrollTargetLayout()
      .padding()
    }
    .accessibilityIdentifier("songs.scroll")
    .scrollPosition(
      id: Binding(
        get: { model.scrollAnchor },
        set: { if let anchor = $0 { model.scrollAnchor = anchor } }
      ), anchor: .bottom
    )
    .libraryNavigationTitle("Songs")
    .task(id: isActive) { if isActive { await model.open() } }
  }
}

struct ArtistsView: View {
  @Bindable var model: PagedLibrary<Artist>
  var isActive = true

  var body: some View {
    ScrollView {
      Text("\(model.isLoading && model.items.isEmpty ? "…" : model.countText) artists")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("artists.count")
      LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        ForEach(model.items) { artist in
          VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
            NavigationLink(value: LibraryRoute.artist(artist)) {
              HStack(spacing: DesignTokens.Spacing.l) {
                AlbumArtwork(artworkURL: artist.artworkURL)
                  .frame(width: 48, height: 48)
                  .clipShape(Circle())
                Text(artist.name).font(.headline)
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
              }
              .padding(.vertical, 4)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("artist.\(artist.id)")
            Divider()
          }
          .id(artist.id)
        }
        LibraryPageStatus(model: model, noun: "artists")
      }
      .scrollTargetLayout()
      .padding()
    }
    .accessibilityIdentifier("artists.scroll")
    .scrollPosition(
      id: Binding(
        get: { model.scrollAnchor },
        set: { if let anchor = $0 { model.scrollAnchor = anchor } }
      ), anchor: .bottom
    )
    .libraryNavigationTitle("Artists")
    .task(id: isActive) { if isActive { await model.open() } }
  }
}

struct ArtistDetail: View {
  let artist: Artist
  let model: ArtistLibraryModel

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.l) {
        Text("Songs").font(.title2.bold()).accessibilityIdentifier("artist.songs.title")
        ForEach(model.songs.items) { TrackRow(track: $0, showsTrackNumber: false) }
        LibraryPageStatus(model: model.songs, noun: "artist-songs")
        Text("Releases").font(.title2.bold()).accessibilityIdentifier("artist.releases.title")
        AlbumCardGrid {
          ForEach(model.releases.items) { album in
            NavigationLink(value: LibraryRoute.album(album)) {
              AlbumCardView(
                artworkURL: album.artworkURL, title: album.title,
                artist: album.albumArtist, year: album.year.map(String.init) ?? "")
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("album.\(album.id)")
          }
        }
        LibraryPageStatus(model: model.releases, noun: "releases")
      }
      .padding()
    }
    .accessibilityIdentifier("artist.detail.scroll")
    .libraryNavigationTitle(artist.name)
    .task { await model.songs.open() }
    .task { await model.releases.open() }
  }
}

struct LibraryPageStatus<Item: Identifiable>: View {
  let model: PagedLibrary<Item>
  let noun: String

  private var skeletonLayout: LibrarySkeleton.Layout {
    switch noun {
    case "artists": .artists
    case "playlists": .playlists
    case "releases": .albums
    case "search-albums": .albumResults
    case "search-artists", "search-playlists": .searchLinks
    default: .songs
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      if model.isLoading || !model.hasOpened {
        LibrarySkeleton(
          layout: skeletonLayout, count: model.items.isEmpty ? 6 : 2,
          showsDividers: noun == "songs" || noun == "artists",
          label: "Loading \(noun.replacingOccurrences(of: "-", with: " "))", identifier: "\(noun).loading"
        )
      } else if let error = model.errorText {
        Text(error).foregroundStyle(.secondary).accessibilityIdentifier("\(noun).error")
        Button("Retry") { Task { await model.retry() } }
          .accessibilityIdentifier("\(noun).retry")
      } else if model.hasOpened && model.items.isEmpty {
        ContentUnavailableView {
          Label("No \(noun.replacingOccurrences(of: "artist-", with: "")) yet", systemImage: "music.note")
            .accessibilityIdentifier("\(noun).empty.title")
        }
      } else if model.nextCursor != nil {
        Button("Load more") { Task { await model.next() } }
          .accessibilityIdentifier("\(noun).more")
          .task { await model.next() }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
