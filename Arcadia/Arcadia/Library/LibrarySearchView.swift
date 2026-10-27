import SwiftUI

struct LibrarySearchView: View {
  @Bindable var model: LibrarySearchModel

  private var loadingLayout: LibrarySkeleton.Layout {
    switch model.category {
    case .songs: .songs
    case .albums: .albumResults
    case .artists, .playlists: .searchLinks
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      #if !os(macOS)
        TextField("Search library", text: $model.query)
          .textFieldStyle(.roundedBorder)
          .accessibilityIdentifier("search.query")
          .onSubmit { model.search(immediately: true) }
        Picker("Category", selection: $model.category) {
          ForEach(SearchCategory.allCases) { category in
            Text("\(category.title) (\(searchCount(model.sections[category])))")
              .tag(category)
              .accessibilityIdentifier("search.category.\(category.rawValue)")
          }
        }
        .pickerStyle(.segmented)
      #endif
      if model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        ContentUnavailableView(
          "Search your library", systemImage: "magnifyingglass",
          description: Text("Find songs, artists, albums and playlists.")
        )
        .accessibilityIdentifier("search.initial")
      } else {
        #if os(macOS)
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
              if !model.pendingCategories.isEmpty {
                ProgressView("Searching your library").accessibilityIdentifier("search.other.loading")
              }
              if model.hasNoMatches {
                Text("No matches in your library. Try a different search.")
                  .foregroundStyle(.secondary).accessibilityIdentifier("search.all.empty")
              }
              ForEach([SearchCategory.artists, .albums, .songs, .playlists]) { category in
                if let page = model.sections[category] {
                  Text(category.title).font(.headline).padding(.top, 12)
                    .accessibilityIdentifier("search.heading.\(category.rawValue)")
                    .accessibilityValue("\(page.countText) results")
                  Divider()
                  ForEach(page.items) { result in
                    MacSearchResultRow(result: result)
                    Divider()
                  }
                  if page.hasOpened && page.items.isEmpty && !page.isLoading && page.errorText == nil {
                    Text("No \(category.rawValue) found").foregroundStyle(.secondary)
                      .accessibilityIdentifier("search.\(category.rawValue).empty")
                  } else {
                    LibraryPageStatus(model: page, noun: "search-\(category.rawValue)")
                  }
                }
              }
            }
          }.accessibilityIdentifier("search.results.scroll")
        #else
          if let page = model.sections[model.category] {
            SearchResultsView(page: page, model: model)
          } else {
            ScrollView {
              LibrarySkeleton(layout: loadingLayout, label: "Searching", identifier: "search.loading")
                .padding(.vertical)
            }
            .accessibilityIdentifier("search.results.scroll")
          }
        #endif
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
  @Bindable var model: LibrarySearchModel

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
          SearchEmptyCategoryView(model: model)
        } else {
          LibraryPageStatus(model: page, noun: "search-\(model.category.rawValue)")
        }
      }
      .padding(.vertical)
    }
    .accessibilityIdentifier("search.results.scroll")
  }
}

private struct SearchEmptyCategoryView: View {
  @Bindable var model: LibrarySearchModel

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      if !model.matchingCategories.isEmpty {
        Text("Matches in other categories")
          .font(.headline)
          .accessibilityIdentifier("search.other.matches")
        ForEach(model.matchingCategories.filter { $0 != model.category }) { category in
          Button("Show \(category.title) (\(searchCount(model.sections[category])))") {
            model.category = category
          }
          .buttonStyle(.bordered)
          .accessibilityIdentifier("search.show.\(category.rawValue)")
        }
      }
      if model.hasNoMatches {
        ContentUnavailableView {
          Label("No \(model.category.rawValue) found", systemImage: "magnifyingglass")
            .accessibilityIdentifier("search.\(model.category.rawValue).empty")
        } description: {
          Text("No matches in your library. Try a different search.")
            .accessibilityIdentifier("search.all.empty")
        }
      } else {
        Text("No \(model.category.rawValue) found")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("search.\(model.category.rawValue).empty")
      }
      if !model.pendingCategories.isEmpty {
        ProgressView("Searching other categories")
          .accessibilityIdentifier("search.other.loading")
      }
      ForEach(model.failedCategories.filter { $0 != model.category }) { category in
        VStack(alignment: .leading) {
          Text("\(category.title) search unavailable")
            .accessibilityIdentifier("search.\(category.rawValue).unavailable")
          Button("Retry \(category.title)") {
            Task { await model.sections[category]?.retry() }
          }
          .accessibilityIdentifier("search.retry.\(category.rawValue)")
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

@MainActor
private func searchCount(_ page: PagedLibrary<LibrarySearchResult>?) -> String {
  page?.countText ?? "0"
}

#if os(macOS)
  private struct MacSearchResultRow: View {
    let result: LibrarySearchResult
    var body: some View {
      switch result {
      case .song(let track):
        TrackRow(track: track, showsTrackNumber: false)
      case .artist(let artist):
        NavigationLink(value: LibraryRoute.artist(artist)) {
          HStack(spacing: 16) {
            AlbumArtwork(artworkURL: artist.artworkURL).frame(width: 54, height: 54).clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
              Text(artist.name)
              Text("Artist").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
          }.contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("search.artist.\(artist.id)")
      case .album(let album):
        NavigationLink(value: LibraryRoute.album(album)) {
          HStack(spacing: 16) {
            AlbumArtwork(artworkURL: album.artworkURL).frame(width: 54, height: 54)
              .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 4) {
              Text(album.title)
              Text(album.year.map(String.init) ?? album.albumArtist).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
          }.contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("search.album.\(album.id)")
      case .playlist(let playlist):
        NavigationLink(value: LibraryRoute.playlist(playlist)) {
          Label(playlist.title, systemImage: "music.note.list")
        }.accessibilityIdentifier("search.playlist.\(playlist.id)")
      }
    }
  }
#endif
