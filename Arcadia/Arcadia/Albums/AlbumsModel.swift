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
  private(set) var totalCount: Int?
  var countText: String { libraryCountText(total: totalCount, loaded: albums.count, hasMore: hasNextPage) }
  private var nextCursor: String?
  var loadState = LoadMode.initial
  var errorText: String?
  private var searchTerm = ""
  private var hasOpened = false
  @ObservationIgnored private var openingTask: Task<Void, Never>?

  var hasNextPage: Bool {
    return nextCursor != nil
  }

  func onOpen() async {
    if let openingTask {
      await openingTask.value
      return
    }
    guard !hasOpened else { return }
    hasOpened = true
    // The library model owns its initial request. SwiftUI can replace a presentation
    // task during connection or layout changes without canceling the shared load.
    let task = Task { await load(LoadMode.initial) }
    openingTask = task
    await task.value
    openingTask = nil
  }

  func onRetry() async {
    guard loadState == .loaded, errorText != nil else { return }
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
    if mode == .nextPage && (loadState != .loaded || nextCursor == nil) { return }
    if mode == .initial {
      albums = []
      totalCount = nil
      nextCursor = nil
    }
    AppDiagnostics.event(mode == .nextPage ? "albums.next-page.loading" : "albums.initial.loading")
    errorText = nil
    loadState = mode

    do {
      let response = try await albumService.fetchAlbums(
        FetchAlbumsRequest(
          cursor: nextCursor,
          searchTerm: normalisedSearchTerm
        )
      )

      var identities = Set(albums.map(\.id))
      albums.append(contentsOf: response.albums.filter { identities.insert($0.id).inserted })
      totalCount = response.totalCount ?? totalCount
      nextCursor = response.nextCursor
      AppDiagnostics.event("albums.loaded")
    } catch {
      errorText = error.localizedDescription
      AppDiagnostics.event("albums.failed")
    }

    loadState = LoadMode.loaded
  }
}
