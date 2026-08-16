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
            try AppConfiguration.load()
        }
    }
    
    
    var body: some Scene {
        WindowGroup {
            switch configuration {
            case .success(let configuration):
                AppView(
                    api: ArcadiaAPI(
                        baseURL: configuration.arcadiaBaseURL
                    )
                )
            case .failure(let error):
                ContentUnavailableView(
                    "Configuration Error",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error.localizedDescription)
                )
            }
        }
    }
}
