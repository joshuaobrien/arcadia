//
//  AppView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
  case albums
  case artists
  case songs

  var id: Self { self }
}

struct AppView: View {
  let albumService: AlbumService

  @State private var albumsModel: AlbumsModel
  @State private var playerStore = PlayerStore()
  @State private var selection: AppSection? = .albums

  init(albumService: AlbumService) {
    self.albumService = albumService
    _albumsModel = State(initialValue: AlbumsModel(albumService: albumService))
  }

  var body: some View {
    VStack(spacing: DesignTokens.Spacing.none) {
      NavigationSplitView {
        List(AppSection.allCases, selection: $selection) { section in
          Text(section.rawValue.capitalized)

        }
      } detail: {
        NavigationStack {
          ContentView(selection: selection, albumService: albumService, albumsModel: albumsModel)
        }
      }

      PlayerBar()
    }
    .environment(playerStore)
  }
}
