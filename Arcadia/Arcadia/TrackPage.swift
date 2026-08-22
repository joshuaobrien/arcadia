//
//  TrackPage.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import Foundation

struct TrackPage: Decodable {
  let total: Int
  let items: [Track]
  let nextCursor: String?
}
