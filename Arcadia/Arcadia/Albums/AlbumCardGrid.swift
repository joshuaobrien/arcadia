import SwiftUI

struct AlbumCardGrid<Content: View>: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  #if os(macOS)
    @ScaledMetric(relativeTo: .body) private var minimumAlbumWidth: CGFloat = 140
  #else
    @ScaledMetric(relativeTo: .body) private var minimumAlbumWidth: CGFloat = 150
  #endif
  private let content: Content
  var isList: Bool
  var minimumWidth: CGFloat?

  init(isList: Bool = false, minimumWidth: CGFloat? = nil, @ViewBuilder content: () -> Content) {
    self.isList = isList
    self.minimumWidth = minimumWidth
    self.content = content()
  }

  var body: some View {
    LazyVGrid(
      columns: [
        GridItem(
          isList || dynamicTypeSize.isAccessibilitySize
            ? .flexible() : .adaptive(minimum: minimumWidth ?? minimumAlbumWidth),
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
