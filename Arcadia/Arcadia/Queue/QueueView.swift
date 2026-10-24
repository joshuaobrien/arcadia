import SwiftUI

struct QueueView: View {
  @Environment(PlayerStore.self) private var playerStore
  @Binding var scrollPosition: ScrollPosition
  @Binding var scrollOffset: CGFloat
  @State private var tracksUserScroll = false

  var body: some View {
    VStack(alignment: .leading) {
      Text("Queue").font(.title2.bold()).accessibilityIdentifier("queue.heading")
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 16) {
          if let current = playerStore.currentEntry {
            Text("Now Playing").font(.headline)
            Text(current.track.title ?? "Untitled track")
              .accessibilityIdentifier("queue.current.\(current.id)")
            CurrentPlaybackIndicator(state: playerStore.state, identifier: "queue.playback.\(current.id)")
          }
          Text("Up Next").font(.headline)
          ForEach(playerStore.upcoming) { entry in
            HStack {
              Button {
                playerStore.playQueuedEntry(entry.id)
              } label: {
                Image(systemName: "play.fill")
              }
              .accessibilityLabel("Play queued \(entry.track.title ?? "song")")
              .accessibilityIdentifier("queue.play")
              VStack(alignment: .leading, spacing: 2) {
                Text(entry.track.title ?? "Untitled track").lineLimit(1)
                if let artists = entry.track.artists, !artists.isEmpty {
                  Text(artists.joined(separator: ", "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              Button {
                playerStore.moveUpcoming(entry.id, by: -1)
              } label: {
                Image(systemName: "arrow.up")
              }
              .disabled(playerStore.upcoming.first?.id == entry.id)
              .accessibilityLabel("Move \(entry.track.title ?? "song") earlier")
              .accessibilityIdentifier("queue.move-up")
              Button {
                playerStore.moveUpcoming(entry.id, by: 1)
              } label: {
                Image(systemName: "arrow.down")
              }
              .disabled(playerStore.upcoming.last?.id == entry.id)
              .accessibilityLabel("Move \(entry.track.title ?? "song") later")
              .accessibilityIdentifier("queue.move-down")
              Button {
                playerStore.removeUpcoming(entry.id)
              } label: {
                Image(systemName: "minus.circle")
              }
              .accessibilityLabel("Remove \(entry.track.title ?? "song") from queue")
              .accessibilityIdentifier("queue.remove")
            }
            .buttonStyle(.borderless)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(entry.track.title ?? "Untitled track")
            .accessibilityIdentifier("queue.entry.\(entry.id)")
          }
        }
        .scrollTargetLayout()
      }
      .accessibilityIdentifier("queue.scroll")
      .scrollPosition($scrollPosition)
      .onAppear { scrollPosition.scrollTo(y: scrollOffset) }
      .onScrollPhaseChange { _, phase in
        tracksUserScroll = phase == .interacting || phase == .decelerating || phase == .tracking
      }
      .onScrollGeometryChange(for: CGFloat.self) { geometry in
        geometry.contentOffset.y + geometry.contentInsets.top
      } action: { _, offset in
        if tracksUserScroll { scrollOffset = offset }
      }
    }
    .padding()
    .frame(minWidth: 280)
  }
}
