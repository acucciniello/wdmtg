// swift-tools-version: 5.9
// Lets the app's pure logic be tested with `swift test` (no simulator needed).
// The app itself is built from WDMTG.xcodeproj.
import PackageDescription

let package = Package(
    name: "WDMTGCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "WDMTGCore", targets: ["WDMTGCore"])],
    targets: [
        .target(name: "WDMTGCore", path: "WDMTG/Core"),
        .testTarget(
            name: "WDMTGCoreTests",
            dependencies: ["WDMTGCore"],
            path: "Tests/WDMTGCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
