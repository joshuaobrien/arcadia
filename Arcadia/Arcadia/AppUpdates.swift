#if os(macOS)
  import Combine
  import Sparkle
  import SwiftUI

  /// Release owns its updater for the lifetime of the app. Development builds never poll the feed.
  final class AppUpdates: ObservableObject {
    @Published private(set) var canCheckForUpdates = false
    private let controller: SPUStandardUpdaterController

    init() {
      #if DEBUG
        let startsAutomatically = false
      #else
        let startsAutomatically = true
      #endif
      controller = SPUStandardUpdaterController(
        startingUpdater: startsAutomatically, updaterDelegate: nil, userDriverDelegate: nil)
      controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
    }

    func checkForUpdates() {
      controller.checkForUpdates(nil)
    }
  }

  struct CheckForUpdatesView: View {
    @ObservedObject var updates: AppUpdates

    var body: some View {
      Button("Check for Updates…", action: updates.checkForUpdates)
        .disabled(!updates.canCheckForUpdates)
    }
  }
#endif
