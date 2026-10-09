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
  private let configuration: Result<AppConfiguration, Error>

  init() {
    AVPlayer.isObservationEnabled = true

    configuration = Result {
      let value = try AppConfiguration.load()
      AppDiagnostics.configuration(value)
      return value
    }
  }

  var body: some Scene {
    WindowGroup {
      switch configuration {
      case .success(let configuration):
        AppView(
          albumService: configuration.albumService()
        )
      case .failure(let error):
        ContentUnavailableView(
          "Configuration Error",
          systemImage: "exclamationmark.triangle",
          description: Text(error.localizedDescription)
        )
        .accessibilityIdentifier("configuration.error")
      }
    }
  }
}
