import XCTest

@testable import Arcadia

final class AlbumPaginationTests: XCTestCase {
  @MainActor
  func testAlbumTotalIncludesUnloadedPagesAndSurvivesPagination() async throws {
    let source = FixtureAlbumClient(scenario: .twoPage)
    let model = AlbumsModel(albumService: source)
    await model.onOpen()
    XCTAssertEqual(model.albums.count, 20)
    XCTAssertEqual(model.totalCount, 24)
    XCTAssertEqual(model.countText, "24")
    await model.onReachBottom()
    XCTAssertEqual(model.albums.count, 24)
    XCTAssertEqual(model.countText, "24")
  }

  @MainActor
  func testSongAndArtistCountsIncludeUnloadedItems() async {
    let model = LibraryModel(source: FixtureAlbumClient(scenario: .twoPage))
    await model.songs.open()
    await model.artists.open()
    XCTAssertEqual(model.songs.items.count, 20)
    XCTAssertEqual(model.artists.items.count, 20)
    XCTAssertEqual(model.songs.countText, "24")
    XCTAssertEqual(model.artists.countText, "24")
    await model.songs.next()
    await model.artists.next()
    XCTAssertEqual(model.songs.countText, "24")
    XCTAssertEqual(model.artists.countText, "24")
  }

  @MainActor
  func testLibraryTotalSurvivesFailedNextPageAndRetry() async {
    var attempts = 0
    let item = Artist(id: "one", name: "One", artworkURL: nil)
    let model = PagedLibrary<Artist> { cursor in
      attempts += 1
      if attempts == 2 { throw MusicSourceError.unavailable }
      return LibraryPage(items: [item], nextCursor: cursor == nil ? "next" : nil, totalCount: 2)
    }
    await model.open()
    XCTAssertEqual(model.items.count, 1)
    XCTAssertEqual(model.countText, "2")
    await model.next()
    XCTAssertNotNil(model.errorText)
    XCTAssertEqual(model.countText, "2")
    await model.retry()
    XCTAssertNil(model.errorText)
    XCTAssertEqual(model.countText, "2")
    XCTAssertNil(model.nextCursor)
  }

  @MainActor
  func testFilteredSearchCarriesMatchingTotalInsteadOfLibraryOrLoadedCount() async throws {
    let source = FixtureAlbumClient(scenario: .twoPage)
    for category in SearchCategory.allCases {
      let page = try await source.fetchSearch(
        LibrarySearchRequest(query: "Fixture", category: category, cursor: nil))
      XCTAssertNotNil(page.totalCount)
      if category == .albums {
        XCTAssertEqual(page.items.count, 20)
        XCTAssertEqual(page.totalCount, 23)
      }
    }
    let empty = try await source.fetchSearch(
      LibrarySearchRequest(query: "No matching album", category: .albums, cursor: nil))
    XCTAssertEqual(empty.totalCount, 0)
  }

  @MainActor
  func testUnknownTotalsShowIncompleteCountUntilFinalPage() async {
    let model = AlbumsModel(albumService: OverlappingAlbumPages())
    await model.onOpen()
    XCTAssertNil(model.totalCount)
    XCTAssertEqual(model.countText, "2+")
    await model.onReachBottom()
    XCTAssertEqual(model.countText, "3")
    XCTAssertEqual(libraryCountText(total: 0, loaded: 0, hasMore: false), "0")
  }

  @MainActor
  func testOverlappingPagesKeepFirstAlbumOrderAndConsumeTheSourceCursor() async {
    let model = AlbumsModel(albumService: OverlappingAlbumPages())

    await model.onOpen()
    XCTAssertEqual(model.albums.map(\.id), ["A", "B"])
    XCTAssertTrue(model.hasNextPage)

    await model.onReachBottom()
    XCTAssertEqual(model.albums.map(\.id), ["A", "B", "C"])
    XCTAssertEqual(model.albums.map(\.title), ["First A", "First B", "First C"])
    XCTAssertFalse(model.hasNextPage)
    XCTAssertNil(model.errorText)

    await model.onReachBottom()
    XCTAssertEqual(model.albums.map(\.id), ["A", "B", "C"])
    XCTAssertNil(model.errorText)
  }
}

private struct OverlappingAlbumPages: AlbumService {
  func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    switch request.cursor {
    case nil:
      FetchAlbumsResponse(albums: [album("A", "First A"), album("B", "First B")], nextCursor: "overlap")
    case "overlap":
      FetchAlbumsResponse(
        albums: [album("B", "Repeated B"), album("C", "First C"), album("C", "Repeated C")], nextCursor: nil)
    default:
      throw MusicSourceError.invalidCursor
    }
  }

  func fetchAlbum(_: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    throw MusicSourceError.unsupportedBrowsing
  }

  private func album(_ id: String, _ title: String) -> Album {
    Album(id: id, title: title, albumArtist: "Test Artist", year: nil, trackCount: nil, artworkURL: nil)
  }
}
