//
//  AlbumArtwork.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import SwiftUI

struct AlbumArtwork: View {
    let artworkURL: URL?
    
    
    var body: some View {
        if let artworkURL {
            AsyncImage(url: artworkURL) { phase in
                switch phase {
                case .empty:
                    artworkPlaceholder {
                        ProgressView()
                    }
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    missingArtwork
                @unknown default:
                    missingArtwork
                }
            }
        } else {
            missingArtwork
        }
    }
    
    private var missingArtwork: some View {
        artworkPlaceholder {
            Image(systemName: "opticaldisc")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
        }
    }

    private func artworkPlaceholder<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        ZStack {
            Rectangle()
                .fill(.quaternary)
            content()
        }
    }
}
