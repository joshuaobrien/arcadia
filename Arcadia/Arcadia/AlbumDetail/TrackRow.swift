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
    rowContent
      .contextMenu { SongActions(track: track) }
      .padding(.vertical, 4)
      #if os(macOS)
        .padding(.horizontal, showsTrackNumber ? 8 : 0)
        .background {
          if showsTrackNumber && isCurrentTrack {
            RoundedRectangle(cornerRadius: 8).fill(DesignTokens.Desktop.accent.opacity(0.12))
          }
        }
        .overlay(alignment: .bottom) {
          if showsTrackNumber && !isCurrentTrack { Divider().padding(.leading, 52) }
        }
      #endif
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("track.\(track.id)")
  }

  private var rowContent: some View {
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        accessibleRow
      } else {
        #if os(macOS)
          if showsTrackNumber {
            macAlbumRow
          } else {
            adaptiveRow
          }
        #else
          adaptiveRow
        #endif
      }
    }
  }

  private var adaptiveRow: some View {
    ViewThatFits(in: .horizontal) {
      fullRow
      compactRow
    }
  }

  #if os(macOS)
    private var macAlbumRow: some View {
      HStack(spacing: 16) {
        playButton
        metadata(isCompact: true)
          .frame(maxWidth: .infinity, alignment: .leading)
        duration
        SongActionsMenu(track: track)
      }
    }
  #endif

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
      if isCurrentTrack { playerStore.togglePlayback() } else { playerStore.play([track]) }
    } label: {
      Group {
        #if os(macOS)
          if showsTrackNumber && !dynamicTypeSize.isAccessibilitySize {
            if isCurrentTrack {
              Image(systemName: isPauseAction ? "waveform" : "pause.fill")
                .foregroundStyle(DesignTokens.Desktop.accent)
            } else {
              Text(track.trackNumber.map(String.init) ?? "–")
                .foregroundStyle(.secondary)
                .monospacedDigit()
            }
          } else {
            Image(systemName: isPauseAction ? "pause.fill" : "play.fill")
          }
        #else
          Image(systemName: isPauseAction ? "pause.fill" : "play.fill")
        #endif
      }
      .frame(minWidth: 44, minHeight: 44)
      .overlay {
        if isCurrentTrack && !usesAlbumHighlight {
          RoundedRectangle(cornerRadius: DesignTokens.Radius.m)
            .strokeBorder(.secondary, lineWidth: 1)
            .accessibilityHidden(true)
        }
      }
    }
    .buttonStyle(.borderless)
    .accessibilityLabel("\(playbackAction) \(track.title ?? "Untitled track")")
    .accessibilityValue(isCurrentTrack ? playerStore.state.rawValue.capitalized : "")
    .accessibilityIdentifier("track.\(track.id).play")
  }

  private var isCurrentTrack: Bool { playerStore.currentTrack?.stableID == track.stableID }
  private var usesAlbumHighlight: Bool {
    #if os(macOS)
      return showsTrackNumber
    #else
      return false
    #endif
  }
  private var isPauseAction: Bool { isCurrentTrack && playerStore.isPlaybackRequested }
  private var playbackAction: String {
    guard isCurrentTrack else { return "Play" }
    if isPauseAction { return "Pause" }
    switch playerStore.state {
    case .failed: return "Retry"
    case .ended: return "Play"
    default: return "Resume"
    }
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
      let metadataLayout =
        isCompact || dynamicTypeSize.isAccessibilitySize
        ? AnyLayout(VStackLayout(alignment: .leading, spacing: DesignTokens.Spacing.s))
        : AnyLayout(HStackLayout(spacing: DesignTokens.Spacing.s))
      metadataLayout {
        artistMetadata
        if !showsTrackNumber { albumLink }
      }
    }
  }

  @ViewBuilder
  private var artistMetadata: some View {
    if let references = track.artistReferences, !references.isEmpty {
      let artistLayout =
        dynamicTypeSize.isAccessibilitySize
        ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout())
      artistLayout {
        ForEach(references) { artist in
          NavigationLink(value: LibraryRoute.artist(artist)) {
            Text(artist.name).font(.caption)
              .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
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
