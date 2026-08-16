//
//  ContentView.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 15/8/2026.
//

import SwiftUI

struct ContentView: View {
    let selection: AppSection?
    let api: ArcadiaAPI
    
    var body: some View {
        switch selection {
        case .albums:
            AlbumsView(api: api)
        case .artists:
            Text("Artists")
        case .songs:
            Text("Songs")
        case nil:
            ContentUnavailableView("No Selection", systemImage: "sidebar.left")
        }
        
    }
}
