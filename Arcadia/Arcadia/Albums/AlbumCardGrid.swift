import SwiftUI

struct AlbumCardGrid<Content: View>: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  #if os(macOS)
    @ScaledMetric(relativeTo: .body) private var minimumAlbumWidth: CGFloat = 220
  #else
    @ScaledMetric(relativeTo: .body) private var minimumAlbumWidth: CGFloat = 150
  #endif
  private let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    LazyVGrid(
      columns: [
        GridItem(
          dynamicTypeSize.isAccessibilitySize ? .flexible() : .adaptive(minimum: minimumAlbumWidth),
          spacing: DesignTokens.Spacing.l,
          alignment: .top
        )
      ],
      spacing: DesignTokens.Spacing.l
    ) {
      content
    }
  }
}
