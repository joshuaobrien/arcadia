//
//  ContentView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

struct ContentView: View {
  let selection: AppSection?
  let isActive: Bool
  let albumService: any MusicSource
  let albumsModel: AlbumsModel
  let libraryModel: LibraryModel

  init(
    selection: AppSection?, albumService: any MusicSource, albumsModel: AlbumsModel, libraryModel: LibraryModel,
    isActive: Bool = true
  ) {
    self.isActive = isActive
    self.selection = selection

    self.albumService = albumService
    self.albumsModel = albumsModel
    self.libraryModel = libraryModel
  }

  var body: some View {
    switch selection {
    case .albums:
      Albums(albumService: albumService, model: albumsModel)
    case .artists:
      ArtistsView(model: libraryModel.artists, isActive: isActive)
    case .songs:
      SongsView(model: libraryModel.songs, isActive: isActive)
    case nil:
      ContentUnavailableView("No Selection", systemImage: "sidebar.left")
    }

  }
}
