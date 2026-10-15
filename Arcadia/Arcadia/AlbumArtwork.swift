import SwiftUI

#if os(macOS)
  import AppKit
  private typealias ArtworkImage = NSImage
#else
  import UIKit
  private typealias ArtworkImage = UIImage
#endif

struct AlbumArtwork: View {
  let artworkURL: URL?
  @Environment(\.musicSource) private var musicSource
  @State private var image: ArtworkImage?
  @State private var isLoading = false

  var body: some View {
    Group {
      if let image {
        decodedImage(image)
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

  private func decodedImage(_ image: ArtworkImage) -> Image {
    #if os(macOS)
      Image(nsImage: image)
    #else
      Image(uiImage: image)
    #endif
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
      let loaded: ArtworkImage?
      if artworkURL.isFileURL {
        loaded = ArtworkImage(data: try Data(contentsOf: artworkURL))
      } else if let musicSource {
        loaded = ArtworkImage(data: try await musicSource.artworkData(for: artworkURL))
      } else {
        let (data, response) = try await URLSession.shared.data(
          for: URLRequest(url: artworkURL, timeoutInterval: 15)
        )
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
          throw ArcadiaAPIError.invalidResponse
        }
        loaded = ArtworkImage(data: data)
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
