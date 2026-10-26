#if os(macOS)
  import Combine
  import Sparkle
  import SwiftUI

  /// Release owns its updater for the lifetime of the app. Development builds never poll the feed.
  @MainActor
  public final class AppUpdates: ObservableObject {
    @Published public private(set) var canCheckForUpdates = false
    private let controller: SPUStandardUpdaterController

    public init() {
      #if DEBUG
        let startsAutomatically = false
      #else
        let startsAutomatically = true
      #endif
      controller = SPUStandardUpdaterController(
        startingUpdater: startsAutomatically, updaterDelegate: nil, userDriverDelegate: nil)
      controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
    }

    public func checkForUpdates() {
      controller.checkForUpdates(nil)
    }
  }

  public struct CheckForUpdatesView: View {
    @ObservedObject var updates: AppUpdates

    public init(updates: AppUpdates) {
      self.updates = updates
    }

    public var body: some View {
      Button("Check for Updates…", action: updates.checkForUpdates)
        .disabled(!updates.canCheckForUpdates)
    }
  }
#endif
