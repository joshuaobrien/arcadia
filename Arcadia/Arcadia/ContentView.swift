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

  init(selection: AppSection?, albumService: AlbumService) {
    self.selection = selection

    self.albumService = albumService
  }

  var body: some View {
    switch selection {
    case .albums:
      Albums(albumService: self.albumService)
    case .artists:
      Text("Artists")
    case .songs:
      Text("Songs")
    case nil:
      ContentUnavailableView("No Selection", systemImage: "sidebar.left")
    }

  }
}
