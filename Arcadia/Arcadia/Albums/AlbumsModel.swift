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
  private var api: ArcadiaAPI

  init(api: ArcadiaAPI) {
    self.api = api
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

  private var normalisedSearchTerm: String? {
    let term = searchTerm.trimmingCharacters(in: .whitespacesAndNewlines)

    return term.isEmpty ? nil : term
  }

  func loadAlbums() async {
    nextCursor = nil
    errorText = nil
    isLoading = true

    do {
      let page = try await api.fetchAlbums(term: normalisedSearchTerm)

      albums = page.items
      nextCursor = page.nextCursor
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
      let page = try await api.fetchAlbums(cursor: nextCursor, term: normalisedSearchTerm)

      albums.append(contentsOf: page.items)
      nextCursor = page.nextCursor
    } catch {
      errorText = error.localizedDescription
    }
  }
}
