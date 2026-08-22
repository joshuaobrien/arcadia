//
//  AlbumsView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import SwiftUI

private let minimumAlbumWidth: CGFloat = 220

struct AlbumsView: View {
  let api: ArcadiaAPI

  @State private var nextCursor: String?
  @State private var albums: [Album] = []
  @State private var isLoading = true
  @State private var errorMessage: String?
  @State private var isLoadingNextPage = false
  @State private var paginationErrorMessage: String?
  @State private var searchTerm = ""

  private var normalizedSearchTerm: String? {
    let term = searchTerm.trimmingCharacters(
      in: .whitespacesAndNewlines
    )

    return term.isEmpty ? nil : term
  }

  private func loadAlbums() async {
    nextCursor = nil
    paginationErrorMessage = nil
    isLoading = true
    errorMessage = nil

    do {
      let page = try await api.fetchAlbums(term: normalizedSearchTerm)

      guard page.configured, page.mounted else {
        errorMessage = "The Arcadia library is not configured."
        isLoading = false
        return
      }

      albums = page.items
      nextCursor = page.nextCursor
    } catch {
      errorMessage = error.localizedDescription
    }

    isLoading = false
  }

  private func loadNextPage() async {
    guard let cursor = nextCursor, !isLoadingNextPage else {
      return
    }

    isLoadingNextPage = true
    paginationErrorMessage = nil

    defer {
      isLoadingNextPage = false
    }

    do {
      let page = try await api.fetchAlbums(
        cursor: cursor,
        term: normalizedSearchTerm
      )

      albums.append(contentsOf: page.items)
      nextCursor = page.nextCursor
    } catch {
      paginationErrorMessage = error.localizedDescription
    }
  }

  var body: some View {
    Group {
      if isLoading {
        ProgressView("Loading albums")
      } else if let errorMessage {
        ContentUnavailableView(
          "Couldn't load albums",
          systemImage: "exclamationmark.triangle",
          description: Text(errorMessage)
        )
      } else {
        albumGrid
      }
    }
    .navigationTitle("Albums")
    .searchable(
      text: $searchTerm,
      prompt: "Search albums or artists"
    )
    .task(id: searchTerm) {
      do {
        try await Task.sleep(for: .milliseconds(300))
      } catch {
        return
      }

      await loadAlbums()
    }
  }

  private var albumGrid: some View {
    ScrollView {
      LazyVGrid(
        columns: [
          GridItem(.adaptive(minimum: minimumAlbumWidth))
        ],
        spacing: DesignTokens.Spacing.xl
      ) {
        ForEach(albums) { album in
          NavigationLink {
            AlbumDetailView(album: album, api: api)
          } label: {
            AlbumCard(album: album, artworkURL: api.artworkURL(for: album))
          }
          .buttonStyle(.plain)
          .padding()
        }

        if nextCursor != nil {
          VStack(spacing: DesignTokens.Spacing.s) {
            if isLoadingNextPage {
              ProgressView()
            } else if let paginationErrorMessage {
              Text(paginationErrorMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
              Button("Try Again") {
                Task {
                  await loadNextPage()
                }
              }
            } else {
              ProgressView()
            }
          }
          .task {
            await loadNextPage()
          }
        }
      }
      .navigationTitle("Albums")
    }
  }

  private struct AlbumCard: View {
    let album: Album
    let artworkURL: URL?

    var body: some View {
      VStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
        AlbumArtwork(artworkURL: artworkURL)
          .aspectRatio(1, contentMode: .fit)
          .clipShape(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.m)
          )

        Text(album.title)
          .font(.headline)
          .lineLimit(1)

        Text(album.albumArtist)
          .foregroundStyle(.secondary)
          .lineLimit(1)

        if let year = album.year {
          Text(String(year))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }

  }
}
