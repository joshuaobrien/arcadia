//
//  AppView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
  case albums
  case artists
  case songs

  var id: Self { self }
}

struct AppView: View {
  let albumService: any MusicSource

  @State private var albumsModel: AlbumsModel
  @State private var playerStore: PlayerStore
  @State private var selection: AppSection? = .albums
  @State private var isQueuePresented = false
  @State private var queueScrollPosition = ScrollPosition()
  @State private var queueScrollOffset: CGFloat = 0

  init(albumService: any MusicSource) {
    self.albumService = albumService
    _playerStore = State(initialValue: PlayerStore(source: albumService))
    _albumsModel = State(initialValue: AlbumsModel(albumService: albumService))
  }

  var body: some View {
    VStack(spacing: DesignTokens.Spacing.none) {
      NavigationSplitView {
        List(AppSection.allCases, selection: $selection) { section in
          Text(section.rawValue.capitalized)

        }
      } detail: {
        NavigationStack {
          ContentView(selection: selection, albumService: albumService, albumsModel: albumsModel)
        }
      }

      PlayerBar()
    }
    .inspector(isPresented: $isQueuePresented) {
      QueueView(scrollPosition: $queueScrollPosition, scrollOffset: $queueScrollOffset)
    }
    .overlay(alignment: .bottom) { QueueFeedbackView().padding(.bottom, 100) }
    .toolbar {
      Button("Queue", systemImage: "list.bullet") { isQueuePresented.toggle() }
        .accessibilityIdentifier("queue.toggle")
    }
    .alert(
      "Replace your queue?",
      isPresented: Binding(
        get: { playerStore.needsReplacementConfirmation }, set: { _ in }
      )
    ) {
      Button("Cancel", role: .cancel) { playerStore.cancelReplacement() }
        .accessibilityIdentifier("queue.replace.cancel")
      Button("Replace Queue", role: .destructive) { playerStore.confirmReplacement() }
        .accessibilityIdentifier("queue.replace.confirm")
    } message: {
      Text("This will remove the songs you added to Up Next.")
    }
    .environment(playerStore)
    .environment(\.musicSource, albumService)
    .onDisappear { playerStore.stop() }
  }
}
