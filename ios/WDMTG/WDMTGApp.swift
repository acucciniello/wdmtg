import SwiftUI

@main
struct WDMTGApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
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

    var body: some View {
        TabView {
            DayView()
                .tabItem { Label("Day", systemImage: "sun.max") }
            LogView()
                .tabItem { Label("Log", systemImage: "record.circle") }
            SetupView()
                .tabItem { Label("Setup", systemImage: "gearshape") }
        }
        .tint(Palette.ink)
    }
}
