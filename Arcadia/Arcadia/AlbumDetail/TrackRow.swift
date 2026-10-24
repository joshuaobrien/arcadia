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
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        accessibleRow
      } else {
        ViewThatFits(in: .horizontal) {
          fullRow
          compactRow
        }
      }
    }
    .contextMenu { SongActions(track: track) }
    .padding(.vertical, 4)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("track.\(track.id)")
  }

  private var accessibleRow: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      metadata(isCompact: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: DesignTokens.Spacing.m) {
        playButton
        leadingContent
        Spacer()
        Text(formattedDuration)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
          .fixedSize()
        SongActionsMenu(track: track)
      }
    }
  }

  private var fullRow: some View {
    HStack(spacing: DesignTokens.Spacing.l) {
      playButton
      leadingContent
      metadata(isCompact: false)
      if !showsTrackNumber { albumLink }
      Spacer()
      if let format = track.format {
        Text(format).font(.caption.monospaced()).foregroundStyle(.secondary)
      }
      duration
      SongActionsMenu(track: track)
    }
  }

  private var compactRow: some View {
    HStack(spacing: DesignTokens.Spacing.s) {
      playButton
      leadingContent
      metadata(isCompact: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      duration
      SongActionsMenu(track: track)
    }
  }

  private var playButton: some View {
    Button {
      playerStore.play([track])
    } label: {
      Image(systemName: "play.fill").frame(minWidth: 44, minHeight: 44)
    }
    .buttonStyle(.borderless)
    .accessibilityLabel("Play \(track.title ?? "Untitled track")")
    .accessibilityIdentifier("track.\(track.id).play")
  }

  @ViewBuilder
  private var leadingContent: some View {
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
  }

  private func metadata(isCompact: Bool) -> some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
      Text(track.title ?? "Untitled track")
        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : (isCompact ? 2 : 1))
        .accessibilityIdentifier("track.\(track.id).title")
      if playerStore.currentTrack?.stableID == track.stableID {
        CurrentPlaybackIndicator(state: playerStore.state, identifier: "track.\(track.id).playback")
      }
      if let references = track.artistReferences, !references.isEmpty {
        let artistLayout =
          dynamicTypeSize.isAccessibilitySize
          ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout())
        artistLayout {
          ForEach(references) { artist in
            NavigationLink(value: LibraryRoute.artist(artist)) {
              Text(artist.name).lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            }
            .accessibilityIdentifier("track.\(track.id).artist.\(artist.id)")
          }
        }
        .font(.caption)
      } else if let artists = track.artists {
        Text(artists.joined(separator: ", "))
          .font(.caption).foregroundStyle(.secondary)
          .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
      }
      if isCompact && !showsTrackNumber { albumLink }
    }
  }

  @ViewBuilder
  private var albumLink: some View {
    if let reference = track.albumReference {
      NavigationLink(value: LibraryRoute.album(reference.album())) {
        Text(reference.title).font(.caption).foregroundStyle(.secondary)
          .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
      }
      .accessibilityIdentifier("track.\(track.id).album")
    }
  }

  private var duration: some View {
    Text(formattedDuration)
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
      .frame(width: 42, alignment: .trailing)
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
