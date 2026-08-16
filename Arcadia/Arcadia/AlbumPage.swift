//
//  AlbumPage.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import Foundation

struct AlbumPage: Decodable {
    let configured: Bool
    let mounted: Bool
    let total: Int
    let items: [Album]
    let nextCursor: String?
}
