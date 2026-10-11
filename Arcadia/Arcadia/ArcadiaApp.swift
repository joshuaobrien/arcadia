//
//  ArcadiaApp.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import AVFoundation
import SwiftUI

@main
struct ArcadiaApp: App {
  @State private var connection: SourceConnectionModel?
  @State private var fixtureSession: ListeningSession?
  private let configuration: Result<AppConfiguration, Error>

  init() {
    AVPlayer.isObservationEnabled = true

    let loaded = Result {
      let value = try AppConfiguration.load()
      AppDiagnostics.configuration(value)
      return value
    }
    configuration = loaded
    if case .success(let value) = loaded {
      if value.dataMode == .jellyfin {
        _connection = State(initialValue: SourceConnectionModel(connector: JellyfinConnector()))
        _fixtureSession = State(initialValue: nil)
      } else {
        _connection = State(initialValue: nil)
        _fixtureSession = State(initialValue: ListeningSession(source: value.albumService()))
      }
    } else {
      _connection = State(initialValue: nil)
      _fixtureSession = State(initialValue: nil)
    }
  }

  var body: some Scene {
    WindowGroup {
      switch configuration {
      case .success(let configuration):
        if configuration.dataMode == .jellyfin {
          if let connection { SourceConnectionView(model: connection) }
        } else {
          if let fixtureSession {
            AppView(albumService: fixtureSession.source, listeningSession: fixtureSession)
          }
        }
      case .failure(let error):
        ContentUnavailableView(
          "Configuration Error",
          systemImage: "exclamationmark.triangle",
          description: Text(error.localizedDescription)
        )
        .accessibilityIdentifier("configuration.error")
      }
    }
    .commands {
      PlaybackCommands(player: connection?.listeningSession?.player ?? fixtureSession?.player)
    }
  }
}
