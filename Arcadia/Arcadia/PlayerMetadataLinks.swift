import SwiftUI

struct PlayerMetadataLinks: View {
  let track: Track
  let open: (LibraryRoute) -> Void
  var isCompact = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let artists = track.artistReferences, !artists.isEmpty {
        let layout =
          isCompact
          ? AnyLayout(HStackLayout(spacing: 4)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
        layout {
          ForEach(artists) { artist in
            Button {
              open(.artist(artist))
            } label: {
              Text(artist.name)
                .lineLimit(isCompact ? 1 : nil)
                .fixedSize(horizontal: false, vertical: !isCompact)
            }
            .foregroundStyle(.tint)
            .accessibilityHint("Open artist in library")
            .accessibilityIdentifier("player.artist.\(artist.id)")
          }
        }
        .font(isCompact ? .caption : .title3)
      } else {
        Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
          .font(isCompact ? .caption : .title3)
          .lineLimit(isCompact ? 1 : nil)
          .accessibilityIdentifier("player.artist")
      }
      if let album = track.albumReference {
        Button {
          open(.album(album.album()))
        } label: {
          Text(album.title)
            .lineLimit(isCompact ? 1 : nil)
            .fixedSize(horizontal: false, vertical: !isCompact)
        }
        .font(isCompact ? .caption : .body)
        .foregroundStyle(.tint)
        .accessibilityHint("Open album in library")
        .accessibilityIdentifier("player.album")
      } else {
        Text("Unknown Album")
          .font(isCompact ? .caption : .body)
          .accessibilityIdentifier("player.album")
      }
    }
    .buttonStyle(.plain)
    .foregroundStyle(.secondary)
  }
}
