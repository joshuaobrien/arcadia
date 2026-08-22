//
//  ArcadiaAPI.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import Foundation

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
    
    func artworkURL(for album: Album) -> URL? {
        guard album.hasArtwork else {
            return nil
        }
        
        return baseURL
            .appending(path: "api")
            .appending(path: "library")
            .appending(path: "albums")
            .appending(path: album.id)
            .appending(path: "artwork")
    }
    
    func fetchAlbums(
        cursor: String? = nil,
        limit: Int = 50,
        term: String? = nil
    ) async throws -> AlbumPage {
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
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
        
        let url = baseURL
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
        
        return try JSONDecoder().decode(AlbumPage.self, from: data)
    }
    
    func fetchTracks(for album: Album) async throws -> TrackPage {
        let url = baseURL
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
