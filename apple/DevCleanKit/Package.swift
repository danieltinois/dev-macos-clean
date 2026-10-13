// swift-tools-version: 6.0
// The native side shared by the macOS and iOS apps: the engine bridge, the host,
// cleanup, the report model, and the photo and Files sources (iOS only).
import PackageDescription

let package = Package(
  name: "DevCleanKit",
  defaultLocalization: "pt-BR",
  platforms: [.macOS(.v15), .iOS(.v18)],
  products: [.library(name: "DevCleanKit", targets: ["DevCleanKit"])],
  targets: [
    .target(name: "DevCleanKit"),
    .testTarget(name: "DevCleanKitTests", dependencies: ["DevCleanKit"]),
  ]
)
