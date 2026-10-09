import Testing

@testable import Arcadia

struct AppConfigurationTests {
  @Test func fixturesNeedNoBackend() throws {
    let config = try AppConfiguration.load(environment: [:], bundleBaseURL: nil)
    #expect(config.dataMode == .fixtures)
    #expect(config.fixtureScenario == .success)
  }

  @Test func explicitModesNeverFallBack() {
    #expect(throws: (any Error).self) {
      try AppConfiguration.load(
        environment: ["ARCADIA_DATA_MODE": "integration"], bundleBaseURL: "http://production.example"
      )
    }
    #expect(throws: (any Error).self) {
      try AppConfiguration.load(environment: ["ARCADIA_DATA_MODE": "integration"], bundleBaseURL: nil)
    }
    #expect(throws: (any Error).self) {
      try AppConfiguration.load(environment: ["ARCADIA_DATA_MODE": "typo"], bundleBaseURL: nil)
    }
    #expect(throws: (any Error).self) {
      try AppConfiguration.load(environment: ["ARCADIA_FIXTURE_SCENARIO": "typo"], bundleBaseURL: nil)
    }
  }

  @Test(arguments: [
    "/relative", "file:///tmp/library", "http://user:secret@localhost", "http://localhost?token=secret",
  ])
  func invalidBackend(_ url: String) {
    #expect(throws: (any Error).self) {
      try AppConfiguration.load(
        environment: ["ARCADIA_DATA_MODE": "integration", "ARCADIA_BASE_URL": url], bundleBaseURL: nil
      )
    }
  }

  @Test func twoPagesHaveUniqueIDs() async throws {
    let service = FixtureAlbumClient(scenario: .twoPage)
    let first = try await service.fetchAlbums(FetchAlbumsRequest(cursor: nil, searchTerm: ""))
    let second = try await service.fetchAlbums(FetchAlbumsRequest(cursor: first.nextCursor, searchTerm: ""))
    #expect(first.albums.count == 20)
    #expect(second.albums.count == 4)
    #expect(second.nextCursor == nil)
    #expect(Set((first.albums + second.albums).map(\.id)).count == 24)
  }
}
