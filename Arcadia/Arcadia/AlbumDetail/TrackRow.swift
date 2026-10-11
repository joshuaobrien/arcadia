//
//  TrackRow.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import SwiftUI

struct TrackRow: View {
  let track: Track
  var showsTrackNumber = true
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    HStack(spacing: DesignTokens.Spacing.l) {
      Button {
        playerStore.play([track])
      } label: {
        Image(
          systemName: "play.fill"
        ).frame(width: 24, height: 24)
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Play \(track.title ?? "Untitled track")")
      .accessibilityIdentifier("track.\(track.id).play")

      if showsTrackNumber {
        Text(track.trackNumber.map(String.init) ?? "-")
          .frame(width: 28, alignment: .trailing)
          .foregroundStyle(.secondary)
          .monospacedDigit()
      } else {
        AlbumArtwork(artworkURL: track.artworkURL)
          .frame(width: 44, height: 44)
          .clipShape(RoundedRectangle(cornerRadius: 6))
      }

      VStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
        Text(track.title ?? "Untitled track")
          .lineLimit(1)
          .accessibilityIdentifier("track.\(track.id).title")

        if let references = track.artistReferences, !references.isEmpty {
          HStack {
            ForEach(references) { artist in
              NavigationLink(value: LibraryRoute.artist(artist)) { Text(artist.name).lineLimit(1) }
                .accessibilityIdentifier("track.\(track.id).artist.\(artist.id)")
            }
          }
          .font(.caption)
        } else if let artists = track.artists {
          Text(artists.joined(separator: ", "))
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }

      if !showsTrackNumber, let reference = track.albumReference {
        NavigationLink(value: LibraryRoute.album(reference.album())) {
          Text(reference.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .accessibilityIdentifier("track.\(track.id).album")
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
      SongActionsMenu(track: track)
    }
    .contextMenu { SongActions(track: track) }
    .padding(.vertical, 4)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("track.\(track.id)")
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
