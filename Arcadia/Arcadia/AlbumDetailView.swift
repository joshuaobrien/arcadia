//
//  AlbumDetailView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import SwiftUI

struct AlbumDetailView: View {
    let album: Album
    let api: ArcadiaAPI
    
    @State private var tracks: [Track] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    
    private var playbackQueue: [PlaybackItem] {
        tracks.map { track in
            PlaybackItem(
                track: track,
                streamURL: api.streamURL(for: track)
            )
            
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .bottom, spacing: 24) {
                AlbumArtwork(artworkURL: api.artworkURL(for: album)
                )
                .frame(width: 220, height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(
                    color: .black.opacity(0.2),
                    radius: 10,
                    y: 5
                )
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("ALBUM")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    Text(album.title)
                        .font(.largeTitle)
                        .fontWeight(.bold)
                    
                    Text(album.albumArtist)
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    
                    HStack(spacing: 6) {
                        if let year = album.year {
                            Text(String(year))
                        }
                        
                        if let trackCount = album.trackCount {
                            Text("•")
                            Text("\(trackCount) tracks")
                        }
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
            }
            
            
            Divider()
            
            if isLoading {
                ProgressView("Loading tracks")
            } else if let errorMessage {
                ContentUnavailableView(
                    "Couldn't Load Tracks",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else {
                List(tracks) { track in
                    TrackRow(
                        track: track,
                        streamURL: api.streamURL(for: track),
                        queue: playbackQueue,
                    )
                }
            }
        }
        .padding()
        .navigationTitle(album.title)
        .task {
            await loadTracks()
        }
    }
    
    private func loadTracks() async {
        isLoading = true
        errorMessage = nil
        
        do {
            let page = try await api.fetchTracks(for: album)
            tracks = page.items
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
}

