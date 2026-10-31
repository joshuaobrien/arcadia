import SwiftUI

#if os(macOS)
  struct MacLibrarySidebar: View {
    @Binding var selection: AppSection?

    var body: some View {
      VStack(alignment: .leading, spacing: 16) {
        Label {
          Text("Arcadia")
        } icon: {
          Image(systemName: "waveform.path").foregroundStyle(DesignTokens.Desktop.accent)
        }
        .font(.headline)
        .padding(.horizontal, 20)
        .padding(.top, 16)
        List(selection: $selection) {
          Label {
            Text("Search")
              .accessibilityIdentifier("library.destination.search")
          } icon: {
            Image(systemName: "magnifyingglass")
          }
          .padding(10)
          .background(.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
          .tag(AppSection.search)
          Section("Library") {
            ForEach([AppSection.artists, .albums, .songs, .playlists]) { section in
              Label {
                Text(section.rawValue.capitalized)
                  .accessibilityIdentifier("library.destination.\(section.rawValue)")
              } icon: {
                Image(systemName: sidebarSymbol(for: section))
              }
              .padding(.vertical, 5)
              .tag(section)
            }
          }
        }
        .listStyle(.sidebar)
      }
    }

    private func sidebarSymbol(for section: AppSection) -> String {
      switch section {
      case .artists: "person"
      case .albums: "square.stack"
      case .songs: "music.note"
      case .playlists: "music.note.list"
      case .search: "magnifyingglass"
      }
    }
  }
#endif
