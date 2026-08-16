//
//  PlaybackItem.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 17/8/2026.
//
import Foundation

struct PlaybackItem: Identifiable {
    let track: Track
    let streamURL: URL
    
    var id: String {
        track.id
    }
}
