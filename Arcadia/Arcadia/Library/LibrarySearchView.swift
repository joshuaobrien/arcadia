import SwiftUI

struct LibrarySearchView: View {
  @Bindable var model: LibrarySearchModel

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      TextField("Search library", text: $model.query)
        .textFieldStyle(.roundedBorder)
        .accessibilityIdentifier("search.query")
        .onSubmit { model.search(immediately: true) }
      Picker("Category", selection: $model.category) {
        ForEach(SearchCategory.allCases) { category in
          Text("\(category.title) (\(model.sections[category]?.items.count ?? 0))")
            .tag(category)
            .accessibilityIdentifier("search.category.\(category.rawValue)")
        }
      }
      .pickerStyle(.segmented)
      if model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        ContentUnavailableView(
          "Search your library", systemImage: "magnifyingglass",
          description: Text("Find songs, artists, albums and playlists.")
        )
        .accessibilityIdentifier("search.initial")
      } else if let page = model.sections[model.category] {
        SearchResultsView(page: page, category: model.category)
      } else {
        ProgressView("Searching").accessibilityIdentifier("search.loading")
      }
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .libraryNavigationTitle("Search")
    .onChange(of: model.query) { _, _ in model.search() }
  }
}

private struct SearchResultsView: View {
  let page: PagedLibrary<LibrarySearchResult>
  let category: SearchCategory

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        ForEach(page.items) { result in
          switch result {
          case .song(let track):
            TrackRow(track: track, showsTrackNumber: false)
          case .artist(let artist):
            NavigationLink(value: LibraryRoute.artist(artist)) {
              Label(artist.name, systemImage: "person.fill")
            }
            .accessibilityIdentifier("search.artist.\(artist.id)")
          case .album(let album):
            NavigationLink(value: LibraryRoute.album(album)) {
              AlbumCardView(
                artworkURL: album.artworkURL, title: album.title, artist: album.albumArtist,
                year: album.year.map(String.init) ?? ""
              )
              .frame(width: 180)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("search.album.\(album.id)")
          case .playlist(let playlist):
            NavigationLink(value: LibraryRoute.playlist(playlist)) {
              Label(playlist.title, systemImage: "music.note.list")
            }
            .accessibilityIdentifier("search.playlist.\(playlist.id)")
          }
        }
        if page.hasOpened && page.items.isEmpty && !page.isLoading && page.errorText == nil {
          ContentUnavailableView {
            Label("No matches", systemImage: "magnifyingglass")
              .accessibilityIdentifier("search.\(category.rawValue).empty")
          } description: {
            Text("Try a different search.")
          }
        } else {
          LibraryPageStatus(model: page, noun: "search-\(category.rawValue)")
        }
      }
      .padding(.vertical)
    }
    .accessibilityIdentifier("search.results.scroll")
  }
}
