import SwiftUI

@main
struct WDMTGApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.refresh() }
                .onOpenURL { url in
                    if let pairing = Pairing(url: url) { model.pair(pairing) }
                }
                .onChange(of: phase) { _, new in
                    if new == .active { Task { await model.refresh() } }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    @State private var tab = ProcessInfo.processInfo.environment["WDMTG_TAB"] ?? "day"

    var body: some View {
        TabView(selection: $tab) {
            DayView()
                .tabItem { Label("Day", systemImage: "sun.max") }
                .tag("day")
            LogView()
                .tabItem { Label("Log", systemImage: "record.circle") }
                .tag("log")
            SetupView()
                .tabItem { Label("Setup", systemImage: "gearshape") }
                .tag("setup")
        }
        .tint(Palette.color(.busy))
    }
}
