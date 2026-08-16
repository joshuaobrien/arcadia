//
//  AppView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case albums
    case artists
    case songs
    
    var id: Self { self }
}


struct AppView: View {
    let api: ArcadiaAPI
    
    @State private var playerStore = PlayerStore()
    @State private var selection: AppSection? = .albums

    var body: some View {
        VStack(spacing: 0) {
            NavigationSplitView {
                List(AppSection.allCases, selection: $selection) { section in
                    Text(section.rawValue.capitalized)
                
                }
            } detail: {
                NavigationStack {
                    ContentView(selection: selection, api: api)
                }
            }
            
            PlayerBar()
        }
        .environment(playerStore)
    }
}

