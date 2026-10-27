import SwiftUI

#if DEBUG
  extension AppView {
    // Visual-loop runs use a frozen, paused fixture queue; normal launches and tests stay untouched.
    var usesVisualPlayerFixture: Bool {
      let environment = ProcessInfo.processInfo.environment
      return environment["ARCADIA_VISUAL_RUN_ID"] != nil
        && environment["ARCADIA_DATA_MODE"] == "fixtures"
        && environment["ARCADIA_FIXTURE_SCENARIO"] == "success"
    }

    func prepareVisualPlayer() async {
      guard usesVisualPlayerFixture else { return }
      do {
        let songs = try await albumService.fetchSongs(SongBrowseRequest(cursor: nil, searchTerm: ""))
        playerStore.play(Array(songs.items.prefix(3)))
        playerStore.pause()
        #if os(iOS)
          isPlayerPresented = true
        #endif
      } catch {
        // A failed fixture cannot satisfy the frame readiness gate below.
      }
    }

    var developmentFrameReady: Bool {
      if usesVisualPlayerFixture && playerStore.state != .paused { return false }
      let capturingLoading = ProcessInfo.processInfo.environment["ARCADIA_FIXTURE_SCENARIO"] == "loading"
      return switch AppSection(rawValue: destination) ?? .songs {
      case .songs:
        libraryModel.songs.hasOpened && libraryModel.songs.isLoading == capturingLoading
      case .artists:
        libraryModel.artists.hasOpened && libraryModel.artists.isLoading == capturingLoading
      case .playlists:
        libraryModel.playlists.hasOpened && libraryModel.playlists.isLoading == capturingLoading
      case .albums:
        if capturingLoading {
          albumsModel.loadState == .initial
        } else if case .loaded = albumsModel.loadState {
          true
        } else {
          false
        }
      case .search: true
      }
    }
  }
#endif
