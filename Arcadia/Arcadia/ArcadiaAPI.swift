//
//  ArcadiaAPI.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import Foundation

private struct AlbumResponse: Decodable {
  let id: String
  let title: String
  let albumArtist: String
  let year: Int?
  let trackCount: Int?
  let artworkPath: String?
}

private struct AlbumPageResponse: Decodable {
  let configured: Bool
  let mounted: Bool
  let total: Int
  let items: [AlbumResponse]
  let nextCursor: String?
}

struct ArcadiaAPI {
  let baseURL: URL

  func streamURL(for track: Track) -> URL {
    baseURL
      .appending(path: "api")
      .appending(path: "library")
      .appending(path: "songs")
      .appending(path: track.id)
      .appending(path: "stream")
  }

  func fetchAlbums(
    cursor: String? = nil,
    limit: Int = 25,
    term: String? = nil
  ) async throws -> AlbumPage {
    var queryItems = [
      URLQueryItem(name: "limit", value: String(limit))
    ]

    if let cursor {
      queryItems.append(
        URLQueryItem(
          name: "cursor",
          value: cursor
        )
      )
    }

    if let term, !term.isEmpty {
      queryItems.append(
        URLQueryItem(
          name: "term",
          value: term,
        )
      )
    }

    let url =
      baseURL
      .appending(path: "api")
      .appending(path: "library")
      .appending(path: "albums")
      .appending(queryItems: queryItems)

    let (data, response) = try await URLSession.shared.data(from: url)

    guard let response = response as? HTTPURLResponse else {
      throw ArcadiaAPIError.invalidResponse
    }

    guard response.statusCode == 200 else {
      throw ArcadiaAPIError.httpStatus(response.statusCode)
    }

    let pageResponse = try JSONDecoder().decode(AlbumPageResponse.self, from: data)

    return AlbumPage(
      configured: pageResponse.configured,
      mounted: pageResponse.mounted,
      total: pageResponse.total,
      items: pageResponse.items.map { album in
        Album(
          id: album.id,
          title: album.title,
          albumArtist: album.albumArtist,
          year: album.year,
          trackCount: album.trackCount,
          artworkURL: album.artworkPath.flatMap { path in
            URL(string: path, relativeTo: baseURL)?.absoluteURL
          }
        )
      },
      nextCursor: pageResponse.nextCursor
    )
  }

  func fetchTracks(for album: Album) async throws -> TrackPage {
    let url =
      baseURL
      .appending(path: "api")
      .appending(path: "library")
      .appending(path: "albums")
      .appending(path: album.id)
      .appending(path: "tracks")
      .appending(
        queryItems: [
          URLQueryItem(name: "limit", value: "100")
        ]
      )

    let (data, response) = try await URLSession.shared.data(from: url)

    guard let response = response as? HTTPURLResponse else {
      throw ArcadiaAPIError.invalidResponse
    }

    guard response.statusCode == 200 else {
      throw ArcadiaAPIError.httpStatus(response.statusCode)
    }

    return try JSONDecoder().decode(TrackPage.self, from: data)
  }
}

enum ArcadiaAPIError: Error {
  case invalidResponse
  case httpStatus(Int)
}
