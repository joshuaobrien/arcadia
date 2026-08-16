//
//  TrackRow.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import SwiftUI

struct TrackRow: View {
    @Environment(PlayerStore.self) private var playerStore
    
    let track: Track
    let streamURL: URL
    let queue: [PlaybackItem]
    
    private var isCurrentTrack: Bool {
        playerStore.currentTrack?.id == track.id
    }
    
    var body: some View {
        HStack(spacing: 12) {
            Button {
                if isCurrentTrack {
                    playerStore.togglePlayback()
                } else {
                    playerStore.play(track, from: streamURL, in: queue)
                }
            } label: {
                Image(
                    systemName: isCurrentTrack && playerStore.isPlaying
                    ? "pause.fill"
                    : "play.fill"
                ).frame(width: 24, height: 24)
            }
            .buttonStyle(.borderless)
            
            Text(track.trackNumber.map(String.init) ?? "-")
                .frame(width: 28, alignment: .trailing)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            
            VStack(alignment: .leading, spacing: 3) {
                Text(track.title ?? "Untitled track")
                    .lineLimit(1)
                
                if let artists = track.artists {
                    Text(artists.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            
            Spacer()
            
            if let format = track.format {
                Text(format)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            
            Text(formattedDuration)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 42, alignment: .trailing)
        }
        .padding(.vertical, 4)
    }
    
    private var formattedDuration: String {
        guard let seconds = track.durationSeconds else {
            return "-"
        }
        
        let totalSeconds = Int(seconds.rounded())
        let minutes = totalSeconds / 60
        let remainingSeconds = totalSeconds % 60
        
        return String(
            format: "%d:%02d",
            minutes,
            remainingSeconds,
        )
    }
}
