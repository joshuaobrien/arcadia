import AppKit
import SwiftUI

struct AlbumArtwork: View {
  let artworkURL: URL?
  @State private var image: NSImage?
  @State private var isLoading = false

  var body: some View {
    Group {
      if let image {
        Image(nsImage: image)
          .resizable()
          .scaledToFill()
          .accessibilityLabel("Album artwork")
          .accessibilityIdentifier("artwork.loaded")
      } else {
        artworkPlaceholder {
          if isLoading {
            ProgressView()
          } else {
            Image(systemName: "opticaldisc")
              .font(.largeTitle)
              .foregroundStyle(.secondary)
          }
        }
      }
    }
    .task(id: artworkURL) { await load() }
  }

  private func load() async {
    image = nil
    guard let artworkURL else {
      isLoading = false
      return
    }
    isLoading = true
    AppDiagnostics.event("artwork.loading")
    do {
      let loaded: NSImage?
      if artworkURL.isFileURL {
        loaded = NSImage(contentsOf: artworkURL)
      } else {
        let (data, response) = try await URLSession.shared.data(
          for: URLRequest(url: artworkURL, timeoutInterval: 15)
        )
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
          throw ArcadiaAPIError.invalidResponse
        }
        loaded = NSImage(data: data)
      }
      try Task.checkCancellation()
      image = loaded
      AppDiagnostics.event(loaded == nil ? "artwork.failed" : "artwork.loaded")
    } catch {
      if Task.isCancelled { return }
      AppDiagnostics.event("artwork.failed")
    }
    isLoading = false
  }

  private func artworkPlaceholder<Content: View>(
    @ViewBuilder content: () -> Content
  ) -> some View {
    ZStack {
      Rectangle()
        .fill(.quaternary)
      content()
    }
  }
}
