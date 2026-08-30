//
//  AlbumsModelTests.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 30/8/2026.
//
import Mockable
import Testing
@testable import Arcadia

@MainActor
struct AlbumsModelTests {
  let service: MockAlbumService
  let model: AlbumsModel
  
  init() {
    service = MockAlbumService()
    model = AlbumsModel(albumService: service)
  }

  @Test
  func errorsWhenLoadingFails() async {
    given(service)
      .fetchAlbums(.any)
      .willThrow(TestError.expected)
    
    await model.loadAlbums()
    
    #expect(model.errorText != nil)
  }
  
  @Test
  func storesReturnedAlbumsWhenLoadingSucceeds() async {
    let album = Album(
      id: "1",
      title: "a",
      albumArtist: "b",
      year: 2000,
      trackCount: 3,
      artworkURL: nil,
    )

    given(service)
      .fetchAlbums(.any)
      .willReturn(
        FetchAlbumsResponse(
          albums: [album],
          nextCursor: nil
        )
      )

    await model.loadAlbums()

    #expect(model.albums.map(\.id) == ["1"])
  }
  
  private enum TestError: Error {
    case expected
  }
}
