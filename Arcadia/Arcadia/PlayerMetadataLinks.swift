import SwiftUI

struct PlayerMetadataLinks: View {
  let track: Track
  let open: (LibraryRoute) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let artists = track.artistReferences, !artists.isEmpty {
        ForEach(artists) { artist in
          Button {
            open(.artist(artist))
          } label: {
            Text(artist.name)
              .fixedSize(horizontal: false, vertical: true)
          }
          .foregroundStyle(.tint)
          .accessibilityHint("Open artist in library")
          .accessibilityIdentifier("player.artist.\(artist.id)")
        }
        .font(.title3)
      } else {
        Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
          .font(.title3)
          .accessibilityIdentifier("player.artist")
      }
      if let album = track.albumReference {
        Button {
          open(.album(album.album()))
        } label: {
          Text(album.title)
            .fixedSize(horizontal: false, vertical: true)
        }
        .font(.body)
        .foregroundStyle(.tint)
        .accessibilityHint("Open album in library")
        .accessibilityIdentifier("player.album")
      } else {
        Text("Unknown Album")
          .font(.body)
          .accessibilityIdentifier("player.album")
      }
    }
    .buttonStyle(.plain)
    .foregroundStyle(.secondary)
  }
}
