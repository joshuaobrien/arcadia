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

  var id: Self { self }
}

struct AppView: View {
  let albumService: any MusicSource

  @State private var albumsModel: AlbumsModel
  @State private var playerStore: PlayerStore
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
    VStack(spacing: DesignTokens.Spacing.none) {
      NavigationSplitView {
        List(AppSection.allCases, selection: selectionBinding) { section in
          Text(section.rawValue.capitalized)
            .accessibilityIdentifier("library.destination.\(section.rawValue)")

        }
      } detail: {
        ZStack {
          ForEach(AppSection.allCases) { section in
            NavigationStack(path: pathBinding(for: section)) {
              ContentView(
                selection: section, albumService: albumService, albumsModel: albumsModel, libraryModel: libraryModel,
                isActive: selection == section
              )
              .navigationDestination(for: LibraryRoute.self) { route in
                switch route {
                case .artist(let artist):
                  ArtistDetail(artist: artist, model: libraryModel.library(for: artist))
                case .album(let album):
                  AlbumDetail(albumService: albumService, album: album)
                }
              }
            }
            .opacity(selection == section ? 1 : 0)
            .allowsHitTesting(selection == section)
            .accessibilityHidden(selection != section)
          }
        }
      }

      PlayerBar()
    }
    .environment(playerStore)
    .environment(\.musicSource, albumService)
    .onDisappear { playerStore.stop() }
  }

  private var selection: AppSection { AppSection(rawValue: destination) ?? .songs }

  private var selectionBinding: Binding<AppSection?> {
    Binding(get: { selection }, set: { destination = ($0 ?? .songs).rawValue })
  }

  private func pathBinding(for section: AppSection) -> Binding<NavigationPath> {
    return Binding(get: { paths[section] ?? NavigationPath() }, set: { paths[section] = $0 })
  }

}
