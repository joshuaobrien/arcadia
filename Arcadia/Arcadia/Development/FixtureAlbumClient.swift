#if DEBUG
  import Foundation

  final class FixtureAlbumClient: AlbumService {
    private let scenario: AppConfiguration.FixtureScenario

    init(scenario: AppConfiguration.FixtureScenario) {
      self.scenario = scenario
    }

    func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
      AppDiagnostics.event("albums.request")
      if scenario == .failure { throw FixtureError.requestFailed }
      if scenario == .empty { return FetchAlbumsResponse(albums: [], nextCursor: nil) }
      if scenario == .twoPage {
        if let cursor = request.cursor {
          guard cursor == "page-2" else { throw FixtureError.invalidCursor }
          return FetchAlbumsResponse(albums: albums(21...24), nextCursor: nil)
        }
        return FetchAlbumsResponse(albums: albums(1...20), nextCursor: "page-2")
      }
      return FetchAlbumsResponse(albums: albums(1...1), nextCursor: nil)
    }

    func fetchAlbum(_ request: FetchAlbumRequest) async throws -> FetchAlbumResponse {
      AppDiagnostics.event("tracks.request")
      guard request.albumId.hasPrefix("fixture-") else { throw FixtureError.invalidAlbum }
      return FetchAlbumResponse(
        total: 3,
        items: (1...3).map { number in
          Track(
            id: "\(request.albumId)-track-\(number)", relativePath: nil,
            title: ["The First Song", "The Second Song", "The Third Song"][number - 1],
            artists: ["Bjork"], trackNumber: number, discNumber: 1, durationSeconds: 63, format: "MP3"
          )
        },
        nextCursor: nil
      )
    }

    private func albums(_ numbers: ClosedRange<Int>) -> [Album] {
      numbers.map { number in
        Album(
          id: "fixture-\(number)", title: number == 1 ? "Hyperballad" : "Fixture Album \(number)",
          albumArtist: "Bjork", year: 1996, trackCount: 3,
          artworkURL: Bundle.main.url(forResource: "FixtureArtwork", withExtension: "png")
        )
      }
    }
  }

  private enum FixtureError: LocalizedError {
    case requestFailed
    case invalidCursor
    case invalidAlbum

    var errorDescription: String? {
      switch self {
      case .requestFailed: "Fixture request failed."
      case .invalidCursor: "Unexpected fixture cursor."
      case .invalidAlbum: "Unexpected fixture album."
      }
    }
  }
#endif
