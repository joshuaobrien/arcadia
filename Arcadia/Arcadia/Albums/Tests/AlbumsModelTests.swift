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

    #expect(model.errorText == nil)

    await model.onOpen()

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

    await model.onOpen()

    #expect(model.albums.map(\.id) == ["1"])
  }

  @Test
  func preservesExistingAlbumsWhenLoadingNextPageFails() async {
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
      .fetchAlbums(.any)
      .willThrow(TestError.expected)

    await model.onOpen()
    await model.onReachBottom()

    #expect(model.albums.map(\.id) == ["1"])
  }

  @Test
  func clearsErrorAfterRetrySucceeds() async {
    given(service)
      .fetchAlbums(.any)
      .willThrow(TestError.expected)
      .fetchAlbums(.any)
      .willReturn(
        FetchAlbumsResponse(
          albums: [],
          nextCursor: "some value"
        )
      )

    await model.onOpen()
    #expect(model.errorText != nil)
    await model.onOpen()
    #expect(model.errorText == nil)
  }

  @Test
  func reportsWhetherAnotherPageIsAvailable() async {
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
          nextCursor: "some value"
        )
      )

    await model.onOpen()

    #expect(model.hasNextPage == true)
  }

  @Test
  func appendsAlbumsWhenLoadingNextPageSucceeds() async {
    let initialAlbum = Album(
      id: "1",
      title: "a",
      albumArtist: "b",
      year: 2000,
      trackCount: 3,
      artworkURL: nil,
    )
    let nextAlbum = Album(
      id: "2",
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
          albums: [initialAlbum],
          nextCursor: "some value"
        )
      )
      .fetchAlbums(.any)
      .willReturn(
        FetchAlbumsResponse(
          albums: [nextAlbum],
          nextCursor: nil
        )
      )

    await model.onOpen()

    #expect(model.albums.map(\.id) == ["1"])
    #expect(model.hasNextPage == true)

    await model.onReachBottom()
    #expect(model.albums.map(\.id) == ["1", "2"])
    #expect(model.hasNextPage == false)
  }

  private enum TestError: Error {
    case expected
  }
}
