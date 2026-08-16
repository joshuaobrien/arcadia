//
//  PlayerBar.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import SwiftUI

struct PlayerBar: View {
    @Environment(PlayerStore.self) private var playerStore
    
    @State private var isScrubbing = false
    @State private var scrubPosition = 0.0
    @State private var resumedAfterScrubbing = false
    
    var body: some View {
        if let track = playerStore.currentTrack {
            VStack(spacing: 6) {
                controls(for: track)
                progress
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial)
            .overlay(alignment: .top) {
                Divider()
            }
        }
    }
    
    private func controls(for track: Track) -> some View {
        HStack(spacing: 14) {
            Button {
                playerStore.togglePlayback()
            } label: {
                Image(
                    systemName: playerStore.isPlaying
                    ? "pause.fill"
                    : "play.fill"
                )
                .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderless)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title ?? "Untitled track")
                    .font(.headline)
                    .lineLimit(1)
                
                if let artists = track.artists {
                    Text(artists.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            
            Spacer()
        }
    }
    
    private var progress: some View {
        let maximum = max(playerStore.duration, 1)
        
        let displayedTime = isScrubbing
            ? scrubPosition
            : playerStore.currentTime
        
        return HStack(spacing: 10) {
            Text(formatTime(displayedTime))
                .frame(width: 42, alignment: .trailing)
            
            Slider(
                value: Binding(
                    get: {
                        displayedTime
                    },
                    set: { newValue in
                        scrubPosition = newValue
                    }
                ),
                in: 0...maximum,
                onEditingChanged: { isEditing in
                    if isEditing {
                        scrubPosition = playerStore.currentTime
                        resumedAfterScrubbing = playerStore.isPlaying
                        isScrubbing = true
                        playerStore.pause()
                    } else {
                        playerStore.seek(
                            to: scrubPosition,
                            resumeAfterSeeking: resumedAfterScrubbing
                        )
                        isScrubbing = false
                    }
                }
            )
            .disabled(playerStore.duration <= 0)
            
            Text(formatTime(playerStore.duration))
                .frame(width: 42, alignment: .leading)
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
    }
    
    private func formatTime(_ duration: Double) -> String {
        let totalSeconds = Int(duration.rounded())
         let minutes = totalSeconds / 60
         let seconds = totalSeconds % 60

         return String(
             format: "%d:%02d",
             minutes,
             seconds
         )
    }
        
    
    private func formatDuration(_ duration: Double) -> String {
            let totalSeconds = Int(duration.rounded())
            let minutes = totalSeconds / 60
            let seconds = totalSeconds % 60

            return String(
                format: "%d:%02d",
                minutes,
                seconds
            )
        }
}
