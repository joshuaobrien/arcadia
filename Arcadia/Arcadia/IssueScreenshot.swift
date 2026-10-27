import SwiftUI

#if os(macOS)
  import AppKit
  import ScreenCaptureKit
#else
  import UIKit
#endif

struct IssueScreenshot {
  let image: CGImage

  @MainActor static func capture() async -> IssueScreenshot? {
    #if os(macOS)
      guard let window = NSApp.keyWindow else { return nil }
      let windowID = CGWindowID(window.windowNumber)
      do {
        // This inventory is restricted to content our process may capture without TCC consent.
        let content = try await SCShareableContent.currentProcess
        guard
          let ownWindow = content.windows.first(where: {
            $0.windowID == windowID && $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier
          })
        else { return nil }
        let filter = SCContentFilter(desktopIndependentWindow: ownWindow)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(window.frame.width * window.backingScaleFactor)
        configuration.height = Int(window.frame.height * window.backingScaleFactor)
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        return IssueScreenshot(image: image)
      } catch {
        return nil
      }
    #else
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      guard let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) else { return nil }
      let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
      let snapshot = renderer.image { _ in
        _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
      }
      guard let image = snapshot.cgImage else { return nil }
      return IssueScreenshot(image: image)
    #endif
  }

  func cropped(to selection: CGRect?) -> IssueScreenshot? {
    guard let selection else { return self }
    let rect = CGRect(
      x: selection.minX * CGFloat(image.width), y: selection.minY * CGFloat(image.height),
      width: selection.width * CGFloat(image.width), height: selection.height * CGFloat(image.height))
    guard let cropped = image.cropping(to: rect.integral) else { return nil }
    return IssueScreenshot(image: cropped)
  }

  var png: Data? {
    #if os(macOS)
      NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    #else
      UIImage(cgImage: image).pngData()
    #endif
  }
}

struct IssueScreenshotPicker: View {
  let screenshot: IssueScreenshot
  @Binding var selection: CGRect?

  var body: some View {
    Image(screenshot.image, scale: 1, label: Text("App screenshot. Drag to select a region."))
      .resizable()
      .scaledToFit()
      .overlay {
        GeometryReader { geometry in
          if let selection {
            Rectangle().stroke(.yellow, lineWidth: 3)
              .background(.yellow.opacity(0.15))
              .frame(width: selection.width * geometry.size.width, height: selection.height * geometry.size.height)
              .position(x: selection.midX * geometry.size.width, y: selection.midY * geometry.size.height)
          }
          Color.clear.contentShape(Rectangle())
            .gesture(
              DragGesture(minimumDistance: 4).onChanged { drag in
                let start = CGPoint(
                  x: max(0, min(1, drag.startLocation.x / geometry.size.width)),
                  y: max(0, min(1, drag.startLocation.y / geometry.size.height)))
                let end = CGPoint(
                  x: max(0, min(1, drag.location.x / geometry.size.width)),
                  y: max(0, min(1, drag.location.y / geometry.size.height)))
                let rect = CGRect(
                  x: min(start.x, end.x), y: min(start.y, end.y),
                  width: abs(start.x - end.x), height: abs(start.y - end.y))
                selection = rect.width > 0.01 && rect.height > 0.01 ? rect : nil
              })
        }
      }
      .accessibilityLabel("App screenshot. Drag to select a region.")
      .accessibilityIdentifier("issue.screenshot")
  }
}
