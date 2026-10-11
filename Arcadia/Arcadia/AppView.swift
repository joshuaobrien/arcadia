//
//  AppView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
  case songs
  case artists
  case albums
  case playlists
  case search

  var id: Self { self }
}

struct AppView: View {
  let albumService: any MusicSource

  @State private var albumsModel: AlbumsModel
  @State private var playerStore: PlayerStore
  @State private var isQueuePresented = false
  @State private var isPlayerPresented = false
  @State private var queueScrollPosition = ScrollPosition()
  @State private var queueScrollOffset: CGFloat = 0
  @State private var libraryModel: LibraryModel
  @State private var paths: [AppSection: NavigationPath] = [:]
  @AppStorage private var destination: String

  init(albumService: any MusicSource) {
    self.albumService = albumService
    _playerStore = State(initialValue: PlayerStore(source: albumService))
    _albumsModel = State(initialValue: AlbumsModel(albumService: albumService))
    _libraryModel = State(initialValue: LibraryModel(source: albumService))
    let namespace = ProcessInfo.processInfo.environment["ARCADIA_LIBRARY_NAMESPACE"] ?? "default"
    _destination = AppStorage(wrappedValue: "songs", "arcadia.library.destination.\(namespace)")
  }

  var body: some View {
    platformShell
    .overlay(alignment: .bottom) { QueueFeedbackView().padding(.bottom, 100) }
    .alert(
      "Replace your queue?",
      isPresented: Binding(
        get: { playerStore.needsReplacementConfirmation }, set: { _ in }
      )
    ) {
      Button("Cancel", role: .cancel) { playerStore.cancelReplacement() }
        .accessibilityIdentifier("queue.replace.cancel")
      Button("Replace Queue", role: .destructive) { playerStore.confirmReplacement() }
        .accessibilityIdentifier("queue.replace.confirm")
    } message: {
      Text("This will remove the songs you added to Up Next.")
    }
    .environment(playerStore)
    .environment(\.musicSource, albumService)
    #if os(macOS)
      .onDisappear { playerStore.stop() }
    #endif
  }

  @ViewBuilder
  private var platformShell: some View {
    #if os(iOS)
      phoneShell
    #else
      VStack(spacing: 0) {
        NavigationSplitView {
          List(AppSection.allCases, selection: selectionBinding) { section in
            Text(section.rawValue.capitalized)
              .accessibilityIdentifier("library.destination.\(section.rawValue)")
          }
        } detail: {
          retainedSections(AppSection.allCases)
        }
        PlayerBar()
      }
      .inspector(isPresented: $isQueuePresented) {
        QueueView(scrollPosition: $queueScrollPosition, scrollOffset: $queueScrollOffset)
      }
      .toolbar {
        Button("Queue", systemImage: "list.bullet") { isQueuePresented.toggle() }
          .accessibilityIdentifier("queue.toggle")
      }
    #endif
  }

  private func retainedSections(_ sections: [AppSection], showsCategories: Bool = false) -> some View {
    ZStack {
      ForEach(sections) { section in
        NavigationStack(path: pathBinding(for: section)) {
          VStack(spacing: 0) {
            if showsCategories {
              Picker("Library category", selection: categoryBinding) {
                ForEach([AppSection.songs, .artists, .albums]) { category in
                  Text(category.rawValue.capitalized).tag(category)
                    .accessibilityIdentifier("library.destination.\(category.rawValue)")
                }
              }
              .pickerStyle(.segmented)
              .padding(.horizontal)
              .padding(.bottom, 8)
            }
            ContentView(
              selection: section, albumService: albumService, albumsModel: albumsModel,
              libraryModel: libraryModel, isActive: selection == section
            )
          }
          .navigationDestination(for: LibraryRoute.self) { route in
            switch route {
            case .artist(let artist):
              ArtistDetail(artist: artist, model: libraryModel.library(for: artist))
            case .playlist(let playlist):
              PlaylistDetail(playlist: playlist, source: albumService, isActive: selection == section)
            case .album(let album):
              AlbumDetail(albumService: albumService, album: album)
            }
          }
        }
        .environment(\.libraryPresentationIsActive, selection == section)
        .opacity(selection == section ? 1 : 0)
        .allowsHitTesting(selection == section)
        .accessibilityHidden(selection != section)
      }
    }
  }

  private var categoryBinding: Binding<AppSection> {
    Binding(get: { [.songs, .artists, .albums].contains(selection) ? selection : .songs },
            set: { destination = $0.rawValue })
  }

  #if os(iOS)
    private enum PhoneTab: Hashable { case library, playlists, search }

    private var phoneTabBinding: Binding<PhoneTab> {
      Binding(get: {
        switch selection {
        case .playlists: .playlists
        case .search: .search
        default: .library
        }
      }, set: { tab in
        switch tab {
        case .library: destination = "songs"
        case .playlists: destination = "playlists"
        case .search: destination = "search"
        }
      })
    }

    private var phoneShell: some View {
      TabView(selection: phoneTabBinding) {
        Tab("Library", systemImage: "music.note", value: PhoneTab.library) {
          retainedSections([.songs, .artists, .albums], showsCategories: true)
        }
        Tab("Playlists", systemImage: "music.note.list", value: PhoneTab.playlists) {
          retainedSections([.playlists])
        }
        Tab("Search", systemImage: "magnifyingglass", value: PhoneTab.search, role: .search) {
          retainedSections([.search])
        }
      }
      .tabViewBottomAccessory {
        if playerStore.currentTrack != nil && !isPlayerPresented {
          CompactPlayerView { isPlayerPresented = true }
        }
      }
      .fullScreenCover(isPresented: $isPlayerPresented) {
        NavigationStack {
          ExpandedPlayerView()
            .navigationTitle("Now Playing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
              ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                  QueueView(scrollPosition: $queueScrollPosition, scrollOffset: $queueScrollOffset)
                    .navigationTitle("Queue")
                } label: { Label("Queue", systemImage: "list.bullet") }
                .accessibilityIdentifier("queue.toggle")
              }
              ToolbarItem(placement: .topBarTrailing) {
                Button("Done", systemImage: "chevron.down") { isPlayerPresented = false }
                  .accessibilityIdentifier("player.dismiss")
              }
            }
        }
      }
    }
  #endif

  private var selection: AppSection { AppSection(rawValue: destination) ?? .songs }

  private var selectionBinding: Binding<AppSection?> {
    Binding(get: { selection }, set: { destination = ($0 ?? .songs).rawValue })
  }

  private func pathBinding(for section: AppSection) -> Binding<NavigationPath> {
    return Binding(get: { paths[section] ?? NavigationPath() }, set: { paths[section] = $0 })
  }

}
