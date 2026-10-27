#if os(macOS)
  import SwiftUI

  struct MacTransportBar: View {
    @Environment(PlayerStore.self) private var playerStore
    let open: (LibraryRoute) -> Void

    var body: some View {
      if let track = playerStore.currentTrack {
        VStack(spacing: 0) {
          Divider()
          HStack(spacing: 20) {
            Button {
              if let album = track.albumReference { open(.album(album.album())) }
            } label: {
              AlbumArtwork(artworkURL: track.artworkURL)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .accessibilityLabel(track.albumReference?.title ?? "Unknown Album")
            .accessibilityHint("Open album in library")
            .disabled(track.albumReference == nil)
            .accessibilityIdentifier("player.album")
            VStack(alignment: .leading, spacing: 3) {
              Text(track.title ?? "Untitled track")
                .font(.headline).foregroundStyle(.primary).lineLimit(1)
                .accessibilityIdentifier("player.title")
              if let artists = track.artistReferences, !artists.isEmpty {
                HStack(spacing: 4) {
                  ForEach(artists) { artist in
                    Button(artist.name) { open(.artist(artist)) }
                      .lineLimit(1).accessibilityIdentifier("player.artist.\(artist.id)")
                  }
                }
              } else {
                Text(track.artists?.joined(separator: ", ") ?? "Unknown Artist")
              }
            }
            .font(.caption).foregroundStyle(.secondary)
            .frame(width: 155, alignment: .leading)
            HStack(spacing: 8) {
              PreviousSongButton()
              PlaybackToggleButton(symbolSize: 24)
              NextSongButton()
            }
            .foregroundStyle(.primary)
            PlaybackProgressView().frame(maxWidth: .infinity)
            HStack(spacing: 8) {
              Image(systemName: "speaker.wave.2.fill").foregroundStyle(.secondary)
              Slider(value: Binding(get: { playerStore.volume }, set: { playerStore.setVolume($0) }), in: 0...1)
                .accessibilityLabel("Volume").accessibilityIdentifier("player.volume")
                .frame(width: 80)
            }
          }
          .buttonStyle(.plain)
          .padding(.horizontal, 24).padding(.vertical, 8)
          PlaybackFailureView()
        }
        .background(.bar)
        .accessibilityElement(children: .contain)
        .accessibilityValue(playerStore.state.rawValue.capitalized)
        .accessibilityIdentifier("player.bar")
      }
    }
  }
  struct MacSearchField: View {
    @Bindable var model: LibrarySearchModel
    let cancel: () -> Void

    var body: some View {
      HStack {
        Image(systemName: "magnifyingglass")
        TextField("Search library", text: $model.query)
          .textFieldStyle(.roundedBorder)
          .accessibilityIdentifier("search.query")
          .onSubmit { model.search(immediately: true) }
        Button("Cancel", action: cancel)
      }.frame(width: 340)
    }
  }
  struct MacQueuePopover: View {
    @Binding var isPresented: Bool
    @Binding var scrollPosition: ScrollPosition
    @Binding var scrollOffset: CGFloat

    var body: some View {
      ZStack(alignment: .topTrailing) {
        Color.clear.contentShape(Rectangle()).onTapGesture { isPresented = false }
        QueueView(scrollPosition: $scrollPosition, scrollOffset: $scrollOffset)
          .frame(width: 380, height: 420)
          .background(.background, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary) }
          .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
          .padding(.top, 8).padding(.trailing, 16)
      }
      .onExitCommand { isPresented = false }
    }
  }
#endif
