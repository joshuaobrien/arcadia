//
//  Album.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import Foundation

struct Album: Identifiable, Decodable {
  let id: String
  let title: String
  let albumArtist: String
  let year: Int?
  let trackCount: Int?
  let hasArtwork: Bool
}
