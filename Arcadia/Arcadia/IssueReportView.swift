import SwiftUI

struct IssueReportButton: View {
  @State private var draft: IssueReportDraft?
  @State private var isCapturing = false

  var body: some View {
    Button("Report an Issue", systemImage: "exclamationmark.bubble") {
      isCapturing = true
      Task {
        draft = IssueReportDraft(screenshot: await IssueScreenshot.capture())
        isCapturing = false
      }
    }
    .accessibilityIdentifier("issue.report")
    .disabled(isCapturing)
    .sheet(item: $draft) { IssueReportView(screenshot: $0.screenshot) }
  }
}

private struct IssueReportDraft: Identifiable {
  let id = UUID()
  let screenshot: IssueScreenshot?
}

struct IssueReportView: View {
  let screenshot: IssueScreenshot?
  @Environment(\.dismiss) private var dismiss
  @State private var title = ""
  @State private var details = ""
  @State private var token = IssueToken().read()
  @State private var selection: CGRect?
  @State private var includeScreenshot = true
  @State private var sending = false
  @State private var error: String?
  @State private var created: IssueReporter.CreatedIssue?
  @State private var attachmentURL: URL?
  @State private var completed = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if completed, let created {
            Label("Issue #\(created.number) created", systemImage: "checkmark.circle")
              .font(.title2)
            Text("The agent label has been assigned.")
            Link("Open issue in Gitea", destination: created.htmlUrl)
          } else {
            fields
            if let created {
              Link("Issue #\(created.number) has been created", destination: created.htmlUrl)
              Text("Retry will finish the screenshot upload and agent label on this issue.")
                .font(.caption)
            }
            if let error {
              Text(error).foregroundStyle(.red).accessibilityIdentifier("issue.error")
            }
            if sending { ProgressView("Sending report…") }
          }
        }
        .padding()
      }
      .navigationTitle("Report an Issue")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(completed ? "Done" : "Cancel") { dismiss() }.disabled(sending)
        }
        if !completed {
          ToolbarItem(placement: .confirmationAction) {
            Button(created == nil ? "Create Issue" : "Retry") { Task { await submit() } }
              .disabled(sending || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || token.isEmpty)
              .accessibilityIdentifier("issue.submit")
          }
        }
      }
    }
    .interactiveDismissDisabled(sending || (created != nil && !completed))
    #if os(macOS)
      .frame(minWidth: 520, idealWidth: 620, minHeight: 450)
    #endif
  }

  private var fields: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Create an issue in jj/arcadia and send it to the agent.").font(.callout)
      TextField("Issue title", text: $title).textFieldStyle(.roundedBorder)
        .accessibilityIdentifier("issue.title")
        .disabled(created != nil)
      Text("Description").font(.headline)
      TextEditor(text: $details).frame(minHeight: 100).border(.secondary.opacity(0.3))
        .accessibilityLabel("Issue description").accessibilityIdentifier("issue.body")
        .disabled(created != nil)
      if let screenshot {
        Toggle("Include screenshot", isOn: $includeScreenshot)
          .disabled(created != nil)
        if includeScreenshot {
          Text("Drag over the screenshot to select the part to share. Review it before sending.")
            .font(.caption)
          IssueScreenshotPicker(screenshot: screenshot, selection: $selection).frame(maxHeight: 420)
            .disabled(created != nil)
          Button("Use full screenshot") { selection = nil }.disabled(selection == nil || created != nil)
        }
      } else {
        Text("Screenshot capture was unavailable. You can still send a written report.").font(.caption)
      }
      SecureField("Gitea access token", text: $token).textFieldStyle(.roundedBorder)
        .accessibilityIdentifier("issue.token")
      Text("Use your Gitea token with repository read and issue write access. It is saved in Keychain.")
        .font(.caption).foregroundStyle(.secondary)
    }
    .disabled(sending)
  }

  @MainActor private func submit() async {
    guard !sending && !completed else { return }
    sending = true
    error = nil
    defer { sending = false }
    do {
      let reporter = IssueReporter(token: token.trimmingCharacters(in: .whitespacesAndNewlines))
      try IssueToken().save(token.trimmingCharacters(in: .whitespacesAndNewlines))
      let label = try await reporter.agentLabel()
      if created == nil {
        created = try await reporter.create(title: title.trimmingCharacters(in: .whitespacesAndNewlines), body: details)
      }
      guard let created else { return }
      if includeScreenshot, let screenshot {
        if attachmentURL == nil {
          guard let png = screenshot.cropped(to: selection)?.png else { throw IssueReporter.Failure.invalidResponse }
          attachmentURL = try await reporter.attach(png, to: created)
        }
        if let attachmentURL {
          try await reporter.updateBody(details + "\n\n![App screenshot](\(attachmentURL.absoluteString))", of: created)
        }
      }
      try await reporter.assignAgent(label, to: created)
      completed = true
    } catch {
      self.error = error.localizedDescription
    }
  }
}
