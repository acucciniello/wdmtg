import SwiftUI

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var host = ""
    @State private var port = "48321"
    @State private var token = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Your computer")
                    Panel {
                        VStack(alignment: .leading, spacing: 8) {
                            if let pairing = model.pairing {
                                Label("Connected to \(pairing.host)", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(Palette.color(.money))
                                Text(model.lastSync.map { "Last sent your drives and logs \($0.formatted(.relative(presentation: .named)))." } ?? "Nothing sent yet.")
                                    .font(.footnote).foregroundStyle(Palette.ink2)
                                Text("Syncing works when this phone and the computer are on the same Wi-Fi. Nothing leaves your network.")
                                    .font(.footnote).foregroundStyle(Palette.ink2)
                                HStack {
                                    Button("Sync now") { Task { await model.refresh() } }
                                        .buttonStyle(.bordered)
                                    Spacer()
                                    Button("Disconnect", role: .destructive) { model.unpair() }
                                        .buttonStyle(.bordered)
                                }
                                .padding(.top, 4)
                            } else {
                                Text("Not connected").font(.headline).foregroundStyle(Palette.ink)
                                Text("Easiest: on your computer open WDMTG, go to Setup, scan the code with this phone's Camera, then tap \"Connect the iPhone app\" on the page that opens.")
                                    .font(.subheadline).foregroundStyle(Palette.ink2)
                                Divider().overlay(Palette.line).padding(.vertical, 4)
                                Text("Or type it in").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                TextField("Address, like 192.168.1.20", text: $host)
                                    .keyboardType(.numbersAndPunctuation).textInputAutocapitalization(.never).autocorrectionDisabled()
                                TextField("Port", text: $port).keyboardType(.numberPad)
                                TextField("Code", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                                Button("Connect") {
                                    if let p = Int(port) {
                                        model.pair(Pairing(host: host.trimmingCharacters(in: .whitespaces), port: p, token: token.trimmingCharacters(in: .whitespaces)))
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(host.isEmpty || token.isEmpty || Int(port) == nil)
                            }
                        }
                        .padding(14)
                    }

                    SectionTitle(text: "Drives")
                    Panel {
                        VStack(alignment: .leading, spacing: 8) {
                            switch model.motionAllowed {
                            case .some(true):
                                Label("On. \(model.drivesFound) drives found in the last 7 days.", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(Palette.color(.money))
                            case .some(false):
                                Label("Off", systemImage: "xmark.circle.fill").foregroundStyle(Palette.color(.lost))
                                Text("Turn on Motion & Fitness for WDMTG in the Settings app to log your drive time.")
                                    .font(.footnote).foregroundStyle(Palette.ink2)
                                Button("Open Settings") {
                                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                                }
                            case .none:
                                Text("Not turned on yet").font(.headline).foregroundStyle(Palette.ink)
                                Button("Turn on drive tracking") { Task { await model.sync() } }
                                    .buttonStyle(.borderedProminent)
                            }
                            Text("Your iPhone already records when you are in a car, on its own, for 7 days. This app reads that when you open it. No GPS, no location, no battery cost.")
                                .font(.footnote).foregroundStyle(Palette.ink2)
                        }
                        .padding(14)
                    }

                    SectionTitle(text: "What this app can and cannot see")
                    Panel {
                        Text("Apple does not let any iPhone app see which other apps you use or who you call. Your computer gets that from iCloud instead (Screen Time and call history), which is why the report lives there. This app adds the parts only the phone knows: your drives and what you tell it.")
                            .font(.subheadline).foregroundStyle(Palette.ink2).padding(14)
                    }
                }
                .padding(16)
            }
            .background(Palette.page)
            .navigationTitle("Setup")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
