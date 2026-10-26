// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ArcadiaUpdates",
  platforms: [.macOS(.v12), .iOS(.v17)],
  products: [.library(name: "ArcadiaUpdates", targets: ["ArcadiaUpdates"])],
  dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")],
  targets: [
    .target(
      name: "ArcadiaUpdates",
      dependencies: [.product(name: "Sparkle", package: "Sparkle", condition: .when(platforms: [.macOS]))]
    )
  ]
)
