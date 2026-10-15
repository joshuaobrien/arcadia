//
//  Track.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import Foundation

struct Track: Decodable, Identifiable {
  let id: String
  let relativePath: String?
  let title: String?
  let artists: [String]?
  let trackNumber: Int?
  let discNumber: Int?
  let durationSeconds: Double?
  let format: String?
  var albumReference: AlbumReference?
  var artistReferences: [Artist]?
  var artworkURL: URL?

  var stableID: String {
    id
  }
}
