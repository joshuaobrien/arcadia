import XCTest

extension XCUIApplication {
  @MainActor
  func libraryDestination(_ name: String) -> XCUIElement {
    let item = menuItems[name.capitalized]
    if !item.exists {
      let menu = descendants(matching: .any).matching(identifier: "library.menu").firstMatch
      _ = menu.waitForExistence(timeout: 20)
      menu.click()
    }
    return item
  }
  @MainActor
  func revealSearchCategory(_ name: String) {
    let scroll = scrollViews["search.results.scroll"]
    _ = scroll.waitForExistence(timeout: 10)
    scroll.scroll(byDeltaX: 0, deltaY: 5000)
    let heading = staticTexts["search.heading.\(name)"]
    for _ in 0..<20 {
      if heading.exists && heading.isHittable { return }
      scroll.scroll(byDeltaX: 0, deltaY: -300)
    }
  }
}
