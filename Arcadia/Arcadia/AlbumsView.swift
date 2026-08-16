//
//  AlbumsView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import SwiftUI

private let minimumAlbumWidth: CGFloat = 220

struct AlbumsView: View {
    let api: ArcadiaAPI
    
    @State private var albums: [Album] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    
    private func loadAlbums() async {
        isLoading = true
        errorMessage = nil
        
        do {
            let page = try await api.fetchAlbums()
            
            guard page.configured, page.mounted else {
                errorMessage = "The Arcadia library is not configured."
                isLoading = false
                return
            }
            
            albums = page.items
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading albums")
            } else if let errorMessage {
                ContentUnavailableView(
                    "Couldn't load albums",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else {
                albumGrid
            }
        }
        .navigationTitle("Albums")
        .task {
            await loadAlbums()
        }
    }
    
    private var albumGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [
                    GridItem(.adaptive(minimum: minimumAlbumWidth))
                ],
                spacing: 24
            ) {
                ForEach(albums) { album in
                    NavigationLink {
                        AlbumDetailView(album: album, api: api)
                    } label: {
                        AlbumCard(album: album, artworkURL: api.artworkURL(for:album))
                    }
                    .buttonStyle(.plain)
                }
                .padding()
            }
            .navigationTitle("Albums")
        }
    }

    private struct AlbumCard: View {
        let album: Album
        let artworkURL: URL?
        
        var body: some View {
            VStack(alignment:. leading, spacing: 8) {
                AlbumArtwork(artworkURL: artworkURL)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                
                Text(album.title)
                    .font(.headline)
                    .lineLimit(1)
                
                Text(album.albumArtist)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                
                if let year = album.year {
                    Text(String(year))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        
        }
    }
