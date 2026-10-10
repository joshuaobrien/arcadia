//
//  ContentView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

struct ContentView: View {
  let selection: AppSection?
  let albumService: AlbumService
  let albumsModel: AlbumsModel

  init(selection: AppSection?, albumService: AlbumService, albumsModel: AlbumsModel) {
    self.selection = selection

    self.albumService = albumService
    self.albumsModel = albumsModel
  }

  var body: some View {
    switch selection {
    case .albums:
      Albums(albumService: albumService, model: albumsModel)
    case .artists:
      Text("Artists")
    case .songs:
      Text("Songs")
    case nil:
      ContentUnavailableView("No Selection", systemImage: "sidebar.left")
    }

  }
}
