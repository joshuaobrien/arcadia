//
//  AlbumsModel.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 23/8/2026.
//
import SwiftUI

enum LoadMode {
  case loaded
  case initial
  case nextPage
}

@MainActor
@Observable
final class AlbumsModel {
  private var albumService: AlbumService

  init(albumService: AlbumService) {
    self.albumService = albumService
  }

  var albums: [Album] = []
  private var nextCursor: String?
  var loadState = LoadMode.initial
  var errorText: String?
  private var searchTerm = ""

  var hasNextPage: Bool {
    return nextCursor != nil
  }

  func onOpen() async {
    await load(LoadMode.initial)
  }

  func onReachBottom() async {
    await load(LoadMode.nextPage)
  }

  private var normalisedSearchTerm: String {
    let term = searchTerm.trimmingCharacters(in: .whitespacesAndNewlines)

    return term.isEmpty ? "" : term
  }

  private func load(_ mode: LoadMode) async {
    errorText = nil
    loadState = mode

    do {
      let response = try await albumService.fetchAlbums(
        FetchAlbumsRequest(
          cursor: nextCursor,
          searchTerm: normalisedSearchTerm
        )
      )

      albums.append(contentsOf: response.albums)
      nextCursor = response.nextCursor
    } catch {
      errorText = error.localizedDescription
    }

    loadState = LoadMode.loaded
  }
}
