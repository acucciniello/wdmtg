import SwiftUI

/// One tap to say what you are doing away from your screens.
struct LogView: View {
    @Environment(AppModel.self) private var model
    @State private var title = ""

    private let presets: [(String, Bucket)] = [
        ("Showing", .money), ("Seller meeting", .money), ("Walkthrough", .money),
        ("Filming", .money), ("Errands", .busy), ("Meeting", .busy),
        ("Gym", .life), ("Family", .life), ("Meal", .life),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let running = model.log.running {
                        Running(entry: running) { model.stopLog() }
                    } else {
                        Text("What are you doing?")
                            .font(.system(.title, design: .rounded, weight: .bold))
                            .foregroundStyle(Palette.ink)
                        Text("Your computer and phone screens are tracked on their own. Use this for everything else, so it does not show up as a blank.")
                            .foregroundStyle(Palette.ink2)

                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                            ForEach(presets, id: \.0) { preset in
                                Button {
                                    model.startLog(title: preset.0, bucket: preset.1)
                                } label: {
                                    HStack(spacing: 7) {
                                        RoundedRectangle(cornerRadius: 3).fill(Palette.color(preset.1)).frame(width: 10, height: 10)
                                        Text(preset.0).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                                        Spacer(minLength: 0)
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 13)
                                    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(Palette.ink)
                            }
                        }

                        SectionTitle(text: "Something else")
                        TextField("Name it", text: $title)
                            .textFieldStyle(.plain)
                            .padding(12)
                            .background(Palette.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        BucketPicker(current: nil) { bucket in
                            model.startLog(title: title, bucket: bucket)
                            title = ""
                        }
                    }

                    if !model.log.finished.isEmpty {
                        SectionTitle(text: "Logged")
                        Panel {
                            ForEach(model.log.finished.prefix(20)) { entry in
                                HStack {
                                    RoundedRectangle(cornerRadius: 3).fill(Palette.color(entry.bucketValue)).frame(width: 10, height: 10)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(entry.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                        Text(when(entry)).font(.caption).foregroundStyle(Palette.ink2)
                                    }
                                    Spacer()
                                    Text(formatDuration((entry.end ?? entry.start) - entry.start))
                                        .font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Palette.ink)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .contextMenu {
                                    Button("Delete", role: .destructive) { model.removeLog(entry) }
                                }
                            }
                        }
                        Text("Touch and hold an entry to delete it from this phone.").font(.footnote).foregroundStyle(Palette.ink2)
                    }
                }
                .padding(16)
            }
            .background(Palette.page)
            .navigationTitle("Log")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func when(_ entry: LogEntry) -> String {
        Date(timeIntervalSince1970: entry.start / 1000).formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}

private struct Running: View {
    var entry: LogEntry
    var stop: () -> Void

    var body: some View {
        let started = Date(timeIntervalSince1970: entry.start / 1000)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 3).fill(Palette.color(entry.bucketValue)).frame(width: 11, height: 11)
                Text(entry.bucketValue.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
            }
            Text(entry.title)
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .foregroundStyle(Palette.ink)
            Text(started, style: .timer)
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Palette.ink)
            Text("Started \(started.formatted(date: .omitted, time: .shortened)). You can lock the phone; it keeps counting.")
                .font(.footnote)
                .foregroundStyle(Palette.ink2)
            Button(action: stop) {
                Text("Stop").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.page)
            .background(Palette.ink, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(.top, 20)
    }
}
