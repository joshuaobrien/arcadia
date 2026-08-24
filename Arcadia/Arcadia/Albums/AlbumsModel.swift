//
//  AlbumsModel.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 23/8/2026.
//
import SwiftUI

@MainActor
@Observable
final class AlbumsModel {
  private var albumService: AlbumService

  init(albumService: AlbumService) {
    self.albumService = albumService
  }

  var albums: [Album] = []
  private var nextCursor: String?
  var isLoading = true
  var isLoadingNextPage = false
  var errorText: String?
  private var searchTerm = ""

  var hasNextPage: Bool {
    return nextCursor != nil
  }

  func onReachBottom() {
    Task {
      await loadNextPage()
    }
  }

  private var normalisedSearchTerm: String {
    let term = searchTerm.trimmingCharacters(in: .whitespacesAndNewlines)

    return term.isEmpty ? "" : term
  }

  func loadAlbums() async {
    nextCursor = nil
    errorText = nil
    isLoading = true

    do {
      let response = try await albumService.fetchAlbums(
        FetchAlbumsRequest(
          cursor: nil,
          searchTerm: normalisedSearchTerm
        )
      )

      albums = response.albums
      nextCursor = response.nextCursor
    } catch {
      errorText = error.localizedDescription
    }

    isLoading = false
  }

  private func loadNextPage() async {
    errorText = nil
    isLoadingNextPage = true

    defer {
      isLoadingNextPage = false
    }

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
  }
}
