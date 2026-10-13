// swift-tools-version: 6.0
// Swift port of core/ (scanner, rules, report) and desktop/cleanup.ts, shared by
// the macOS and iOS apps. Scanning and cleanup only build on macOS.
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
