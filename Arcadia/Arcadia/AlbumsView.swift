//
//  AlbumsView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import SwiftUI

private let minimumAlbumWidth: CGFloat = 160

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
                        AlbumDetailView(album: album)
                    } label: {
                        AlbumCard(album: album)
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
            
            var body: some View {
                VStack(alignment:. leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.quaternary)
                        .aspectRatio(1, contentMode: .fit)
                        .overlay {
                            Image(systemName: "opticaldisc")
                                .font(.largeTitle)
                                .foregroundColor(.secondary)
                        }
                    
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
