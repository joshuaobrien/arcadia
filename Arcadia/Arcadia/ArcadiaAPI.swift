//
//  ArcadiaAPI.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import Foundation

struct ArcadiaAPI {
    let baseURL: URL
    
    func fetchAlbums() async throws -> AlbumPage {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "library")
            .appending(path: "albums")
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let response = response as? HTTPURLResponse else {
            throw ArcadiaAPIError.invalidResponse
        }
        
        guard response.statusCode == 200 else {
            throw ArcadiaAPIError.httpStatus(response.statusCode)
        }
        
        return try JSONDecoder().decode(AlbumPage.self, from: data)
    }
}


enum ArcadiaAPIError: Error {
    case invalidResponse
    case httpStatus(Int)
}
