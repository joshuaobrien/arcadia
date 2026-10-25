import SwiftUI

struct SourceConnectionView: View {
  #if DEBUG
    @State private var developmentRestored = false
  #endif
  @State private var model: SourceConnectionModel

  init(model: SourceConnectionModel) {
    _model = State(initialValue: model)
  }

  var body: some View {
    Group {
      if let source = model.source {
        #if os(iOS)
          AppView(albumService: source, listeningSession: model.listeningSession, disconnect: model.disconnect)
            .environment(\.musicSource, source)
        #else
          AppView(albumService: source, listeningSession: model.listeningSession)
            .environment(\.musicSource, source)
            .toolbar {
              ToolbarItem {
                Button("Disconnect", systemImage: "rectangle.portrait.and.arrow.right") {
                  model.disconnect()
                }
                .accessibilityIdentifier("source.disconnect")
              }
            }
        #endif
      } else {
        connectionForm
          #if DEBUG
            .preference(key: DevelopmentFrameReady.self, value: developmentRestored && !model.isConnecting)
          #endif
      }
    }
    .task {
      await model.restore()
      #if DEBUG
        developmentRestored = true
      #endif
    }
  }

  private var connectionForm: some View {
    VStack(alignment: .leading, spacing: 20) {
      Label("Connect your music", systemImage: "music.note.house")
        .font(.largeTitle.bold())
      Text("Sign in to your music server to browse your library.")
        .foregroundStyle(.secondary)
      Form {
        TextField("Server address", text: $model.server, prompt: Text("https://music.example.com"))
          .accessibilityIdentifier("source.server")
        TextField("Username", text: $model.username)
          .accessibilityIdentifier("source.username")
        SecureField("Password", text: $model.password)
          .accessibilityIdentifier("source.password")
      }
      .disabled(model.isConnecting)
      if let error = model.errorText {
        Text(error)
          .foregroundStyle(.red)
          .accessibilityIdentifier("source.error")
      }
      HStack {
        Button("Connect") { Task { await model.connect() } }
          .buttonStyle(.borderedProminent)
          .disabled(model.isConnecting)
          .accessibilityIdentifier("source.connect")
        if model.isConnecting { ProgressView().controlSize(.small) }
      }
    }
    .padding(32)
    .frame(maxWidth: 520)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension EnvironmentValues {
  @Entry var musicSource: (any MusicSource)?
}
