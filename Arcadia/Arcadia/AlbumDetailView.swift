//
//  AlbumDetailView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import SwiftUI

struct AlbumDetailView: View {
    let album: Album
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(album.title)
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text(album.albumArtist)
                .font(.title2)
                .foregroundStyle(.secondary)
            
            
            Spacer()
        }
        .padding()
        .navigationTitle(album.title)
    }
}

