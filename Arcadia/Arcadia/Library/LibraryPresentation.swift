import SwiftUI

extension EnvironmentValues {
  @Entry var libraryPresentationIsActive = true
}

struct ActiveLibraryTitle: PreferenceKey {
  static var defaultValue: String? { nil }

  static func reduce(value: inout String?, nextValue: () -> String?) {
    if let title = nextValue() { value = title }
  }
}

private struct LibraryNavigationTitle: ViewModifier {
  let title: String
  @Environment(\.libraryPresentationIsActive) private var isActive

  func body(content: Content) -> some View {
    content.navigationTitle(title)
      .preference(key: ActiveLibraryTitle.self, value: isActive ? title : nil)
  }
}

extension View {
  func libraryNavigationTitle(_ title: String) -> some View {
    modifier(LibraryNavigationTitle(title: title))
  }
}
