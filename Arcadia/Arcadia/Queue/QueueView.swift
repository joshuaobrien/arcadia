import SwiftUI

struct QueueView: View {
  @Environment(PlayerStore.self) private var playerStore
  @Binding var scrollPosition: ScrollPosition
  @Binding var scrollOffset: CGFloat
  @State private var tracksUserScroll = false

  var body: some View {
    #if os(macOS)
      macQueue
    #else
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
    #endif
  }

  #if os(macOS)
    private var macQueue: some View {
      VStack(alignment: .leading, spacing: 16) {
        HStack {
          Text("Up Next").font(.title2.bold()).accessibilityIdentifier("queue.heading")
          Spacer()
          Button("Clear") {
            for entry in playerStore.upcoming { playerStore.removeUpcoming(entry.id) }
          }
          .disabled(playerStore.upcoming.isEmpty)
          .accessibilityIdentifier("queue.clear")
        }
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(queueSections, id: \.first?.id) { entries in
              if let origin = entries.first?.origin {
                Text(origin == .manual ? "Added next" : "Continuing from your library")
                  .font(.subheadline).foregroundStyle(.secondary)
                ForEach(entries) { entry in
                  HStack(spacing: 12) {
                    Button {
                      playerStore.playQueuedEntry(entry.id)
                    } label: {
                      HStack(spacing: 12) {
                        AlbumArtwork(artworkURL: entry.track.artworkURL)
                          .frame(width: 54, height: 54).clipShape(RoundedRectangle(cornerRadius: 4))
                        VStack(alignment: .leading, spacing: 4) {
                          Text(entry.track.title ?? "Untitled track").lineLimit(1)
                          Text(entry.track.artists?.joined(separator: ", ") ?? "Unknown Artist")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                      }.contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("queue.play")
                    Text(queueDuration(entry.track.durationSeconds)).foregroundStyle(.secondary)
                    Menu {
                      Button("Move earlier") { playerStore.moveUpcoming(entry.id, by: -1) }
                        .disabled(playerStore.upcoming.first?.id == entry.id)
                        .accessibilityIdentifier("queue.move-up")
                      Button("Move later") { playerStore.moveUpcoming(entry.id, by: 1) }
                        .disabled(playerStore.upcoming.last?.id == entry.id)
                        .accessibilityIdentifier("queue.move-down")
                      Button("Remove") { playerStore.removeUpcoming(entry.id) }
                        .accessibilityIdentifier("queue.remove")
                    } label: {
                      Image(systemName: "ellipsis")
                    }
                    .menuStyle(.borderlessButton).fixedSize()
                    .accessibilityLabel("Queue actions for \(entry.track.title ?? "song")")
                  }
                  .accessibilityElement(children: .contain)
                  .accessibilityLabel(entry.track.title ?? "Untitled track")
                  .accessibilityIdentifier("queue.entry.\(entry.id)")
                }
                Divider()
              }
            }
            if playerStore.upcoming.isEmpty {
              Text("Your queue is empty").foregroundStyle(.secondary)
            }
          }.scrollTargetLayout()
        }
        .accessibilityIdentifier("queue.scroll")
        .scrollPosition($scrollPosition)
        .onAppear { if scrollOffset != 0 { scrollPosition.scrollTo(y: scrollOffset) } }
        .onScrollPhaseChange { _, phase in
          if phase == .interacting || phase == .decelerating || phase == .tracking { tracksUserScroll = true }
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
          geometry.contentOffset.y + geometry.contentInsets.top
        } action: { _, offset in
          if tracksUserScroll { scrollOffset = offset }
        }
        .onDisappear { tracksUserScroll = false }
        if let current = playerStore.currentEntry {
          HStack {
            Text("Now playing: \(current.track.title ?? "Untitled track")")
              .font(.caption).foregroundStyle(.secondary)
              .accessibilityIdentifier("queue.current.\(current.id)")
            CurrentPlaybackIndicator(state: playerStore.state, identifier: "queue.playback.\(current.id)")
          }
        }
      }.padding(20)
    }

    private var queueSections: [[QueueEntry]] {
      playerStore.upcoming.reduce(into: []) { sections, entry in
        if sections.last?.last?.origin == entry.origin {
          sections[sections.count - 1].append(entry)
        } else {
          sections.append([entry])
        }
      }
    }

    private func queueDuration(_ seconds: Double?) -> String {
      guard let seconds, seconds.isFinite else { return "–" }
      let total = max(0, Int(seconds.rounded()))
      return String(format: "%d:%02d", total / 60, total % 60)
    }
  #endif
}
